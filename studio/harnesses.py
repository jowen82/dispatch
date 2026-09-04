"""Registry of agent harnesses Dispatch knows about, beyond Hermes.

Hermes gets FULL automation — see hermes_client.py / hermes_mcp_config.py,
built against its documented `hermes config set` CLI and mcp_servers schema.

The others listed here are real, verified products (checked against their
own sites/docs/repos, not assumed) that Dispatch can *detect* and *rank* for
you, but does not yet auto-configure the way it does Hermes — that's real
follow-up work per harness, gated on researching each one's own config
surface the same way Hermes was. Ranked for Dispatch's use case: running a
multi-agent development org with named roles, local-or-frontier model choice,
and MCP-style tool access.
"""
from __future__ import annotations

import shutil

HARNESS_CATALOG = [
    {
        "id": "hermes",
        "name": "Hermes Agent",
        "vendor": "Nous Research",
        "site": "https://hermes-agent.nousresearch.com/",
        "cli": "hermes",
        "platforms": ["macos", "linux", "windows"],
        "automation": "full",
        "rank_note": (
            "Dispatch's fully-supported harness: documented non-interactive "
            "`hermes config set`, named profiles per agent, MCP support, "
            "local or 10+ frontier providers. Everything else in Dispatch "
            "assumes this one unless you tell it otherwise."
        ),
    },
    {
        "id": "openclaw",
        "name": "OpenClaw",
        "vendor": "Open source (community)",
        "site": "https://openclaw.ai/",
        "cli": "openclaw",
        "platforms": ["macos", "linux", "windows"],
        "automation": "detect_only",
        "rank_note": (
            "Open-source, cross-platform, gateway architecture with "
            "GitHub/browser tool integrations and a real CLI "
            "(`openclaw onboard`, `openclaw update`). Closest shape to "
            "Hermes of the alternatives here — a good second candidate for "
            "full Dispatch automation."
        ),
    },
    {
        "id": "deepseek_harness",
        "name": "DeepSeek Harness",
        "vendor": "DeepSeek",
        "site": "https://www.deepseek.com/harness/en/",
        "cli": "dsh",
        "platforms": ["macos", "linux", "windows"],
        "automation": "detect_only",
        "rank_note": (
            "Plugin-based (Cordis kernel) — every capability, including "
            "models and tools, is a swappable plugin. Developer preview: "
            "flexible, but newer and less battle-tested than Hermes for "
            "long-running multi-agent orgs."
        ),
    },
    {
        "id": "grok_bot",
        "name": "Grok Bot",
        "vendor": "xAI / Cursor",
        "site": "https://x.ai/bot",
        "cli": None,
        "platforms": ["macos"],
        "automation": "manual_only",
        "rank_note": (
            "Hosted desktop app gated behind a Cursor/SuperGrok subscription. "
            "No documented local config file or CLI Dispatch can drive — "
            "you'd set up and manage its Bots entirely inside its own app."
        ),
    },
]


def detect(catalog=HARNESS_CATALOG) -> list[dict]:
    results = []
    for h in catalog:
        installed = bool(h["cli"] and shutil.which(h["cli"]))
        results.append({**h, "installed": installed})
    return results
