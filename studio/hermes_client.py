"""Real integration with a locally running Hermes Agent (Nous Research).

Based on the documented CLI/HTTP surface at https://hermes-agent.nousresearch.com/docs/ :

- `hermes send --to <profile> "text"` sends a one-shot message into a
  profile's canonical chat session — no agent loop needed on our side.
- Agents/bots are Hermes "profiles" living at ~/.hermes/profiles/<name>/,
  each with a SOUL.md persona file. `hermes profile create <name>` makes one.
- The desktop app's bundled backend (`hermes serve`) exposes a liveness
  endpoint at GET http://127.0.0.1:9119/api/status by default.

Every function here is defensive: if the `hermes` CLI isn't on PATH, or a
command fails, that's reported plainly (ok: False, stderr: ...) rather than
assumed to have worked. This replaces the earlier speculative file-only
bridge (studio/hermes_bridge.py) with the documented, verifiable mechanism;
the file-based inbox is still written alongside as a durable audit trail.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_PORT = 9119
TIMEOUT_SECONDS = 20


def available() -> bool:
    return shutil.which("hermes") is not None


def _run(args, timeout=TIMEOUT_SECONDS) -> dict:
    if not available():
        return {"ok": False, "stderr": "hermes CLI not found on PATH."}
    try:
        p = subprocess.run(["hermes", *args], capture_output=True, text=True, timeout=timeout)
        return {
            "ok": p.returncode == 0,
            "code": p.returncode,
            "stdout": p.stdout.strip()[-4000:],
            "stderr": p.stderr.strip()[-4000:],
        }
    except Exception as e:  # pragma: no cover - defensive
        return {"ok": False, "stderr": str(e)}


def serve_status(host="127.0.0.1", port=DEFAULT_PORT) -> dict:
    """Liveness check against the local `hermes serve` backend's /api/status."""
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/api/status", timeout=3) as r:
            return {"ok": True, **json.loads(r.read().decode())}
    except Exception as e:
        return {"ok": False, "stderr": str(e)}


def send(target: str, message: str, timeout=TIMEOUT_SECONDS) -> dict:
    """One-shot message to a running profile's chat session via `hermes send --to`."""
    return _run(["send", "--to", target, message], timeout=timeout)


def profile_exists(profile_id: str) -> bool:
    return (Path.home() / ".hermes" / "profiles" / profile_id).exists()


def _write_soul(profile_id: str, persona_markdown: str) -> None:
    d = Path.home() / ".hermes" / "profiles" / profile_id
    d.mkdir(parents=True, exist_ok=True)
    (d / "SOUL.md").write_text(persona_markdown)


def build_persona(agent: dict) -> str:
    """The SOUL.md body for a Dispatch agent role."""
    lines = [
        f"# {agent['name']}",
        "",
        f"Department: {agent['department']}",
        f"Level: {agent['level']}",
        f"Model capability: {agent['model_capability']}",
        "",
        f"You are the {agent['name']} on a software development team coordinated through Dispatch's Command Center.",
        f"Tools available to you: {', '.join(agent.get('tools', [])) or 'none listed'}.",
        f"Reports to: {agent.get('reports_to') or 'the top of the organization'}.",
        "",
        "When you receive a message from Dispatch about a task, ticket, approval, or a new file, "
        "treat it as a real work item: check the shared project folder for context (it's already "
        "reachable through the filesystem MCP server), do the work relevant to your role, and report back concisely.",
    ]
    return "\n".join(lines)


def create_profile(profile_id: str, persona_markdown: str) -> dict:
    """Create a Hermes profile for a Dispatch agent role if it doesn't already exist,
    and (re)write its persona to SOUL.md either way."""
    if profile_exists(profile_id):
        _write_soul(profile_id, persona_markdown)
        return {"ok": True, "stdout": "profile already existed; refreshed SOUL.md"}
    res = _run(["profile", "create", profile_id])
    if res.get("ok"):
        _write_soul(profile_id, persona_markdown)
    return res
