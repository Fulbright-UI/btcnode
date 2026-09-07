"""Runs the real agent against a fake `systemctl` on the PATH.

The oracle is the fake's log: every call the agent makes is recorded, so
the test checks not only the reply but which command actually ran — and
that nothing ran for a refused request.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
AGENT = HERE.parent / "btcnode-agent.py"

FAKE_SYSTEMCTL = """#!/bin/bash
echo "$@" >> "$FAKE_LOG"
case "$1" in
  show)
    case "$5" in bitcoind|electrs) echo loaded;; *) echo not-found;; esac; exit 0;;
  is-active)
    case "$2" in bitcoind) echo active; exit 0;; electrs) echo inactive; exit 3;; *) echo unknown; exit 4;; esac;;
  restart) [ "$2" = "electrs" ] && { echo "Job failed" >&2; exit 1; }; exit 0;;
  stop|reboot|poweroff) exit 0;;
  *) exit 1;;
esac
"""

# A fake docker CLI: one container "btc-core" is running, everything else is unknown.
FAKE_DOCKER = """#!/bin/bash
echo "docker $@" >> "$FAKE_LOG"
case "$1" in
  inspect) [ "$4" = "btc-core" ] && { echo running; exit 0; }; echo "Error: No such object: $4" >&2; exit 1;;
  restart|stop) echo "$3"; exit 0;;
  *) exit 1;;
esac
"""


class AgentTest(unittest.TestCase):
    """bitcoind and electrs as systemd units — the setup the scripts build."""

    AGENT_ENV = {"BTCNODE_AGENT_UNITS": "bitcoind,electrs", "BTCNODE_AGENT_CONTAINERS": ""}

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        for name, body in (("systemctl", FAKE_SYSTEMCTL), ("docker", FAKE_DOCKER)):
            fake = bin_dir / name
            fake.write_text(body)
            fake.chmod(0o755)
        cls.log = root / "calls.log"
        cls.sock = root / "run" / "agent.sock"
        env = dict(
            os.environ,
            PATH=f"{bin_dir}:{os.environ['PATH']}",
            FAKE_LOG=str(cls.log),
            BTCNODE_AGENT_SOCKET=str(cls.sock),
            BTCNODE_AGENT_GROUP="nogroup-that-does-not-exist",
            **cls.AGENT_ENV,
        )
        cls.proc = subprocess.Popen([sys.executable, str(AGENT)], env=env, stderr=subprocess.PIPE, text=True)
        for _ in range(50):
            if cls.sock.exists():
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("agent did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        cls.tmp.cleanup()

    def ask(self, payload):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(10)
            s.connect(str(self.sock))
            s.sendall(payload if isinstance(payload, bytes) else (json.dumps(payload) + "\n").encode())
            data = b""
            while not data.endswith(b"\n"):
                chunk = s.recv(4096)
                if not chunk:
                    break
                data += chunk
        return json.loads(data)

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_status_reports_units(self):
        r = self.ask({"action": "status"})
        self.assertEqual(r["units"], {"bitcoind": "active", "electrs": "inactive"})
        self.assertEqual(r["available"], ["poweroff", "reboot", "restart-bitcoind", "restart-electrs"])

    def test_restart_runs_exactly_that_unit(self):
        before = len(self.calls())
        r = self.ask({"action": "restart-bitcoind"})
        self.assertTrue(r["ok"])
        # a look at the unit's state first, then exactly one restart
        self.assertEqual([c for c in self.calls()[before:] if "restart" in c], ["restart bitcoind"])

    def test_failed_restart_is_reported(self):
        r = self.ask({"action": "restart-electrs"})
        self.assertFalse(r["ok"])
        self.assertIn("Job failed", r["message"])

    def test_poweroff_stops_the_node_first(self):
        before = len(self.calls())
        r = self.ask({"action": "poweroff"})
        self.assertTrue(r["ok"])
        self.assertEqual([c for c in self.calls()[before:] if "show" not in c and "is-active" not in c], ["stop bitcoind", "poweroff"])

    def test_unknown_actions_run_nothing(self):
        before = len(self.calls())
        for bad in ({"action": "restart-nginx"}, {"action": "status; rm -rf /"}, {"unit": "bitcoind"}, [1, 2]):
            r = self.ask(bad)
            self.assertFalse(r["ok"], bad)
        self.assertEqual(self.calls()[before:], [])

    def test_garbage_and_oversized_requests_are_rejected(self):
        before = len(self.calls())
        self.assertFalse(self.ask(b"not json\n")["ok"])
        self.assertFalse(self.ask(b'{"action": "status", "pad": "' + b"x" * 5000 + b'"}\n')["ok"])
        self.assertEqual(self.calls()[before:], [])


class DockerNodeTest(AgentTest):
    """bitcoind in a container called btc-core, no electrs at all — a node someone else built."""

    AGENT_ENV = {"BTCNODE_AGENT_UNITS": "", "BTCNODE_AGENT_CONTAINERS": "bitcoind=btc-core"}

    def test_status_reports_units(self):
        r = self.ask({"action": "status"})
        self.assertEqual(r["units"], {"bitcoind": "active", "electrs": "missing"})
        self.assertEqual(r["available"], ["poweroff", "reboot", "restart-bitcoind"])

    def test_restart_runs_exactly_that_unit(self):
        before = len(self.calls())
        r = self.ask({"action": "restart-bitcoind"})
        self.assertTrue(r["ok"])
        self.assertEqual(r["message"], "bitcoind restarted")
        self.assertEqual(self.calls()[before:], ["docker inspect -f {{.State.Status}} btc-core", "docker restart -t 120 btc-core"])

    def test_failed_restart_is_reported(self):
        before = len(self.calls())
        r = self.ask({"action": "restart-electrs"})
        self.assertFalse(r["ok"])
        self.assertIn("not installed", r["message"])
        # nothing was restarted — not the unit, not a container
        self.assertEqual([c for c in self.calls()[before:] if "restart" in c], [])

    def test_poweroff_stops_the_node_first(self):
        before = len(self.calls())
        r = self.ask({"action": "poweroff"})
        self.assertTrue(r["ok"])
        self.assertEqual([c for c in self.calls()[before:] if "inspect" not in c], ["docker stop -t 600 btc-core", "poweroff"])


if __name__ == "__main__":
    unittest.main()
