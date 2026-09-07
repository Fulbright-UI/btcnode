#!/usr/bin/env python3
"""btcnode-agent — the only privilege the dashboard has on the host.

Listens on a Unix socket, reads one JSON line per connection and knows
exactly these requests:

    {"action": "status"}            -> {"ok": true, "units": {"bitcoind": "active", ...},
                                        "available": ["restart-bitcoind", "reboot", "poweroff"]}
    {"action": "restart-bitcoind"}  -> systemctl restart bitcoind   (or docker restart <name>)
    {"action": "restart-electrs"}   -> systemctl restart electrs    (or docker restart <name>)
    {"action": "reboot"}            -> systemctl reboot
    {"action": "poweroff"}          -> stop bitcoind cleanly, then systemctl poweroff

Anything else is refused. There is no free-form command, no unit name in
the request, no argument that reaches a shell. The socket carries the
group `btcnode`; the dashboard container joins that group and nothing
else on the host.

Each role (bitcoind, electrs) is either a systemd unit (BTCNODE_AGENT_UNITS)
or a Docker container (BTCNODE_AGENT_CONTAINERS, "role=container,…") — a
node that runs in Docker has no unit to restart. Both lists are fixed at
start; a role that is neither is reported as missing and its restart is
not offered.

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
# Roles the agent may restart and report, fixed at start, never from a request.
# Every role maps to a systemd unit of the same name, unless
# BTCNODE_AGENT_CONTAINERS says it is a Docker container instead.
ROLES = ("bitcoind", "electrs")
UNITS = [u.strip() for u in os.environ.get("BTCNODE_AGENT_UNITS", "bitcoind,electrs").split(",") if u.strip()]
CONTAINERS: dict[str, str] = {}
for _entry in os.environ.get("BTCNODE_AGENT_CONTAINERS", "").split(","):
    if "=" in _entry:
        _role, _name = (x.strip() for x in _entry.split("=", 1))
        if _role and _name:
            CONTAINERS[_role] = _name
NODE_ROLE = "bitcoind"
MAX_REQUEST_BYTES = 4096
READ_TIMEOUT_S = 5
SYSTEMCTL_TIMEOUT_S = 120
# A clean stop of bitcoind flushes the chainstate; on a Pi that takes a while.
STOP_TIMEOUT_S = 600

ACTIONS = {"status", "reboot", "poweroff"} | {f"restart-{r}" for r in ROLES}

_lock = threading.Lock()


def systemctl(*args: str, timeout: int = SYSTEMCTL_TIMEOUT_S) -> tuple[int, str]:
    """Run systemctl with fixed arguments; never through a shell."""
    try:
        r = subprocess.run(["systemctl", *args], capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError) as e:
        return 1, f"systemctl failed: {e.__class__.__name__}"
    return r.returncode, (r.stderr or r.stdout).strip()


def docker(*args: str, timeout: int = SYSTEMCTL_TIMEOUT_S) -> tuple[int, str]:
    """Run the docker CLI with fixed arguments; never through a shell."""
    try:
        r = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError) as e:
        return 1, f"docker failed: {e.__class__.__name__}"
    return r.returncode, (r.stderr or r.stdout).strip()


def unit_state(unit: str) -> str:
    """active / inactive / failed / missing / unknown — missing is a unit systemd has never heard of."""
    code, out = systemctl("show", "-p", "LoadState", "--value", unit, timeout=10)
    if code == 0 and out.strip() == "not-found":
        return "missing"
    code, out = systemctl("is-active", unit, timeout=10)
    state = out.splitlines()[0].strip() if out else ""
    if state in ("active", "inactive", "failed"):
        return state
    return "inactive" if code == 3 else "unknown"


def container_state(name: str) -> str:
    """The same vocabulary for a container: running → active, gone → missing."""
    code, out = docker("inspect", "-f", "{{.State.Status}}", name, timeout=10)
    if code != 0:
        return "missing" if "No such" in out else "unknown"
    status = out.strip()
    if status == "running":
        return "active"
    if status in ("exited", "created", "paused"):
        return "inactive"
    return "failed" if status == "dead" else "unknown"


def role_state(role: str) -> str:
    if role in CONTAINERS:
        return container_state(CONTAINERS[role])
    if role in UNITS:
        return unit_state(role)
    return "missing"


def restart(role: str) -> tuple[int, str]:
    if role in CONTAINERS:
        code, out = docker("restart", "-t", "120", CONTAINERS[role])
        return code, "" if code == 0 else out  # on success docker echoes the name, which says nothing
    return systemctl("restart", role)


def stop(role: str) -> tuple[int, str]:
    if role in CONTAINERS:
        return docker("stop", "-t", str(STOP_TIMEOUT_S), CONTAINERS[role], timeout=STOP_TIMEOUT_S + 30)
    return systemctl("stop", role, timeout=STOP_TIMEOUT_S)


def handle(request: dict[str, Any]) -> dict[str, Any]:
    action = request.get("action")
    if action not in ACTIONS:
        log.warning("refused action %r", action)
        return {"ok": False, "message": "unknown action"}

    if action == "status":
        states = {r: role_state(r) for r in ROLES}
        available = ["reboot", "poweroff"] + [f"restart-{r}" for r in ROLES if states[r] != "missing"]
        return {"ok": True, "units": states, "available": sorted(available)}

    # One action at a time: two restarts racing each other help nobody.
    with _lock:
        log.warning("running %s", action)
        if action.startswith("restart-"):
            role = action[len("restart-"):]
            if role_state(role) == "missing":
                return {"ok": False, "message": f"{role} is not installed here"}
            code, out = restart(role)
            return {"ok": code == 0, "message": out or f"{role} restarted"}
        if action == "reboot":
            code, out = systemctl("reboot")
            return {"ok": code == 0, "message": out or "rebooting"}
        if action == "poweroff":
            # Stop the node first and wait for it: a hard power cut on a
            # running bitcoind risks a reindex of the whole chain.
            if role_state(NODE_ROLE) != "missing":
                code, out = stop(NODE_ROLE)
                if code != 0:
                    return {"ok": False, "message": f"could not stop {NODE_ROLE}: {out}"}
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
