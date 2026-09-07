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
  is-active)
    case "$2" in bitcoind) echo active; exit 0;; electrs) echo inactive; exit 3;; *) echo unknown; exit 4;; esac;;
  restart) [ "$2" = "electrs" ] && { echo "Job failed" >&2; exit 1; }; exit 0;;
  stop|reboot|poweroff) exit 0;;
  *) exit 1;;
esac
"""


class AgentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        fake = bin_dir / "systemctl"
        fake.write_text(FAKE_SYSTEMCTL)
        fake.chmod(0o755)
        cls.log = root / "systemctl.log"
        cls.sock = root / "run" / "agent.sock"
        env = dict(
            os.environ,
            PATH=f"{bin_dir}:{os.environ['PATH']}",
            FAKE_LOG=str(cls.log),
            BTCNODE_AGENT_SOCKET=str(cls.sock),
            BTCNODE_AGENT_GROUP="nogroup-that-does-not-exist",
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
        self.assertEqual(r, {"ok": True, "units": {"bitcoind": "active", "electrs": "inactive"}})

    def test_restart_runs_exactly_that_unit(self):
        before = len(self.calls())
        r = self.ask({"action": "restart-bitcoind"})
        self.assertTrue(r["ok"])
        self.assertEqual(self.calls()[before:], ["restart bitcoind"])

    def test_failed_restart_is_reported(self):
        r = self.ask({"action": "restart-electrs"})
        self.assertFalse(r["ok"])
        self.assertIn("Job failed", r["message"])

    def test_poweroff_stops_the_node_first(self):
        before = len(self.calls())
        r = self.ask({"action": "poweroff"})
        self.assertTrue(r["ok"])
        self.assertEqual(self.calls()[before:], ["stop bitcoind", "poweroff"])

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


if __name__ == "__main__":
    unittest.main()
