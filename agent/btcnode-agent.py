#!/usr/bin/env python3
"""btcnode-agent — the only privilege the dashboard has on the host.

Listens on a Unix socket, reads one JSON line per connection and knows
exactly these requests:

    {"action": "status"}            -> {"ok": true, "units": {"bitcoind": "active", ...}}
    {"action": "restart-bitcoind"}  -> systemctl restart bitcoind
    {"action": "restart-electrs"}   -> systemctl restart electrs
    {"action": "reboot"}            -> systemctl reboot
    {"action": "poweroff"}          -> systemctl stop bitcoind, then systemctl poweroff

Anything else is refused. There is no free-form command, no unit name in
the request, no argument that reaches a shell. The socket carries the
group `btcnode`; the dashboard container joins that group and nothing
else on the host.

Standard library only: the agent runs as root on the Pi, and a dependency
is one more thing to audit there.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import socket
import socketserver
import subprocess
import sys
import threading
from typing import Any

log = logging.getLogger("btcnode-agent")

SOCKET_PATH = os.environ.get("BTCNODE_AGENT_SOCKET", "/run/btcnode-agent/agent.sock")
SOCKET_GROUP = os.environ.get("BTCNODE_AGENT_GROUP", "btcnode")
# Units the agent may restart and report. Fixed at start, never from a request.
UNITS = [u.strip() for u in os.environ.get("BTCNODE_AGENT_UNITS", "bitcoind,electrs").split(",") if u.strip()]
NODE_UNIT = UNITS[0] if UNITS else "bitcoind"
MAX_REQUEST_BYTES = 4096
READ_TIMEOUT_S = 5
SYSTEMCTL_TIMEOUT_S = 120
# A clean stop of bitcoind flushes the chainstate; on a Pi that takes a while.
STOP_TIMEOUT_S = 600

ACTIONS = {"status", "reboot", "poweroff"} | {f"restart-{u}" for u in UNITS}

_lock = threading.Lock()


def systemctl(*args: str, timeout: int = SYSTEMCTL_TIMEOUT_S) -> tuple[int, str]:
    """Run systemctl with fixed arguments; never through a shell."""
    try:
        r = subprocess.run(["systemctl", *args], capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError) as e:
        return 1, f"systemctl failed: {e.__class__.__name__}"
    return r.returncode, (r.stderr or r.stdout).strip()


def unit_state(unit: str) -> str:
    code, out = systemctl("is-active", unit, timeout=10)
    state = out.splitlines()[0].strip() if out else ""
    if state in ("active", "inactive", "failed"):
        return state
    return "inactive" if code == 3 else "unknown"


def handle(request: dict[str, Any]) -> dict[str, Any]:
    action = request.get("action")
    if action not in ACTIONS:
        log.warning("refused action %r", action)
        return {"ok": False, "message": "unknown action"}

    if action == "status":
        return {"ok": True, "units": {u: unit_state(u) for u in UNITS}}

    # One action at a time: two restarts racing each other help nobody.
    with _lock:
        log.warning("running %s", action)
        if action.startswith("restart-"):
            unit = action[len("restart-"):]
            code, out = systemctl("restart", unit)
            return {"ok": code == 0, "message": out or f"{unit} restarted"}
        if action == "reboot":
            code, out = systemctl("reboot")
            return {"ok": code == 0, "message": out or "rebooting"}
        if action == "poweroff":
            # Stop the node first and wait for it: a hard power cut on a
            # running bitcoind risks a reindex of the whole chain.
            code, out = systemctl("stop", NODE_UNIT, timeout=STOP_TIMEOUT_S)
            if code != 0:
                return {"ok": False, "message": f"could not stop {NODE_UNIT}: {out}"}
            code, out = systemctl("poweroff")
            return {"ok": code == 0, "message": out or "shutting down"}
    return {"ok": False, "message": "unhandled"}


class Handler(socketserver.StreamRequestHandler):
    timeout = READ_TIMEOUT_S

    def handle(self) -> None:
        try:
            line = self.rfile.readline(MAX_REQUEST_BYTES + 1)
        except (OSError, socket.timeout):
            return
        if not line or len(line) > MAX_REQUEST_BYTES:
            self.reply({"ok": False, "message": "bad request"})
            return
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("not an object")
        except ValueError:
            self.reply({"ok": False, "message": "bad request"})
            return
        self.reply(handle(request))

    def reply(self, payload: dict[str, Any]) -> None:
        try:
            self.wfile.write(json.dumps(payload).encode() + b"\n")
        except OSError:
            pass


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True


def make_socket(path: str) -> None:
    """The socket is group-accessible only: root writes it, `btcnode` may connect."""
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o750, exist_ok=True)
    if os.path.exists(path):
        os.unlink(path)


def fix_permissions(path: str) -> None:
    try:
        import grp

        gid = grp.getgrnam(SOCKET_GROUP).gr_gid
        os.chown(path, 0, gid)
        os.chown(os.path.dirname(path), 0, gid)
    except (KeyError, PermissionError, OSError) as e:
        log.warning("could not set group %s on %s: %s", SOCKET_GROUP, path, e)
    os.chmod(path, 0o660)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)
    make_socket(SOCKET_PATH)
    server = Server(SOCKET_PATH, Handler)
    fix_permissions(SOCKET_PATH)

    def stop(*_: object) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log.info("listening on %s, actions: %s", SOCKET_PATH, ", ".join(sorted(ACTIONS)))
    try:
        server.serve_forever()
    finally:
        server.server_close()
        if os.path.exists(SOCKET_PATH):
            os.unlink(SOCKET_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
