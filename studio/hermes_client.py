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

# Documented (hermes-agent.nousresearch.com/docs/user-guide/configuration)
# API-key env vars for each frontier provider that has a plain, non-OAuth
# path. `hermes config set <ENV_VAR> <value>` routes secrets to ~/.hermes/.env
# automatically — Dispatch never writes API keys into config.yaml itself.
PROVIDER_ENV_KEY = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai-api": "OPENAI_API_KEY",
    "openai": "OPENAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "xai": "XAI_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "gemini": "GOOGLE_API_KEY",
    "google": "GOOGLE_API_KEY",
}
# Ollama's OpenAI-compatible local endpoint (see docs: "Custom Endpoint" flow).
LOCAL_OLLAMA_BASE_URL = "http://localhost:11434/v1"


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


def config_set(key: str, value: str, profile: str | None = None, timeout=TIMEOUT_SECONDS) -> dict:
    """`hermes [-p <profile>] config set <key> <value>` — the documented,
    non-interactive way to write Hermes config. Routes secrets to .env and
    everything else to config.yaml automatically; scope to one agent's
    profile with `profile=<agent_id>` for a per-agent override."""
    args = (["-p", profile] if profile else []) + ["config", "set", key, str(value)]
    return _run(args, timeout=timeout)


def configure_main_model(provider: str, model: str, api_key: str | None = None,
                          base_url: str | None = None, profile: str | None = None) -> dict:
    """Point Hermes's main model at either a local custom endpoint (Ollama)
    or a frontier API provider, fully non-interactively. Pass `profile` to
    scope the change to one agent's profile instead of the global config."""
    steps = {}
    provider_key = (provider or "").lower()
    if provider_key in ("ollama", "custom", "local"):
        steps["provider"] = config_set("model.provider", "custom", profile)
        steps["base_url"] = config_set("model.base_url", base_url or LOCAL_OLLAMA_BASE_URL, profile)
        steps["model"] = config_set("model.default", model, profile)
    else:
        steps["provider"] = config_set("model.provider", provider_key, profile)
        steps["model"] = config_set("model.default", model, profile)
        if api_key:
            env_key = PROVIDER_ENV_KEY.get(provider_key)
            if env_key:
                steps["api_key"] = config_set(env_key, api_key, profile)
            else:
                steps["api_key"] = {"ok": False, "stderr": f'No known API-key env var for provider "{provider}".'}
    ok = all(s.get("ok") for s in steps.values())
    return {"ok": ok, "provider": provider, "model": model, "profile": profile, "steps": steps}


def verify_provider_key(provider: str, api_key: str, model: str) -> dict:
    """A real connectivity test, not a format check: point a disposable Hermes
    profile at this provider/key/model (scoped with `profile=`, never touching
    the global config or any real agent's profile) and send it one throwaway
    message. If the key or model is bad, Hermes's own `send` call fails and
    that failure is what's reported back — this is the only verification
    Hermes's documented CLI actually supports, there's no separate
    "test credentials" endpoint to call instead."""
    if not available():
        return {"ok": False, "stderr": "hermes CLI not found on PATH — can't verify without it."}
    if not api_key:
        return {"ok": False, "stderr": "No API key provided."}
    profile = "dispatch_verify"
    if not profile_exists(profile):
        created = _run(["profile", "create", profile])
        if not created.get("ok"):
            return {"ok": False, "stderr": f"Could not create a scratch profile to test with: {created.get('stderr')}"}
    cfg = configure_main_model(provider, model or "default", api_key=api_key, profile=profile)
    if not cfg.get("ok"):
        return {"ok": False, "stderr": "Could not write test config", "steps": cfg.get("steps")}
    result = send(profile, "Reply with the single word OK.", timeout=30)
    return {"ok": result.get("ok", False), "stdout": result.get("stdout"), "stderr": result.get("stderr")}


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


def create_profile(profile_id: str, persona_markdown: str, clone: bool = False) -> dict:
    """Create a Hermes profile for a Dispatch agent role if it doesn't already exist,
    and (re)write its persona to SOUL.md either way. With clone=True, the new
    profile is created via `--clone` so it inherits the *current* global
    config.yaml (model, mcp_servers, etc.) instead of starting from Hermes's
    own defaults — call this only after the global config is already set up
    the way you want every agent to start."""
    if profile_exists(profile_id):
        _write_soul(profile_id, persona_markdown)
        return {"ok": True, "stdout": "profile already existed; refreshed SOUL.md"}
    args = ["profile", "create", profile_id] + (["--clone"] if clone else [])
    res = _run(args)
    if res.get("ok"):
        _write_soul(profile_id, persona_markdown)
    return res
