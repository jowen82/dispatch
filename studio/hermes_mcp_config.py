"""Direct, targeted edits to ~/.hermes/config.yaml's mcp_servers block.

Hermes has no `hermes config set` shortcut for authoring an MCP server body
(only `hermes mcp add <name> --preset <preset>` for a short list of known
presets), so this is the one place Dispatch touches Hermes's YAML directly.
It deliberately never rewrites the file wholesale: it only appends server
entries that are not already present, using a line-based scan rather than a
full YAML round-trip, so any existing formatting/comments/servers the person
already has are left untouched. Always call backup_hermes_config() first.
"""
from __future__ import annotations

import shutil
import time
from pathlib import Path

CONFIG_PATH = Path.home() / ".hermes" / "config.yaml"

# The same server set Dispatch has always proposed via the "Generate
# Integration Files" candidate (see hermes_adapter.MCP_SNIPPET) — kept here
# as structured data so both the candidate-file text and this real merge
# stay in sync. `{projects}` is substituted with this Dispatch home's
# projects/ folder at merge time.
MCP_SERVERS = [
    ("filesystem_projects", "npx", ["-y", "@modelcontextprotocol/server-filesystem", "{projects}"]),
    ("context7", "npx", ["-y", "@upstash/context7-mcp"]),
    ("playwright", "npx", ["-y", "@playwright/mcp@latest", "--headless"]),
    ("penpot", "npx", ["-y", "@penpot/mcp@stable"]),
]


def backup_hermes_config() -> str | None:
    """Copy the existing config.yaml aside before Dispatch touches it. Returns
    the backup path, or None if there was no existing file to back up."""
    if not CONFIG_PATH.exists():
        return None
    backup = CONFIG_PATH.with_name(f"config.yaml.dispatch-backup-{int(time.time())}")
    shutil.copy2(CONFIG_PATH, backup)
    return str(backup)


def _server_block(name: str, command: str, args: list[str]) -> str:
    arg_list = ", ".join(f'"{a}"' for a in args)
    return f'  {name}:\n    command: "{command}"\n    args: [{arg_list}]\n'


def merge_mcp_servers(dispatch_home) -> dict:
    """Ensure Dispatch's standard MCP servers exist in ~/.hermes/config.yaml,
    adding only the ones missing. Safe to call repeatedly (idempotent)."""
    projects_path = str(Path(dispatch_home) / "projects")
    text = CONFIG_PATH.read_text() if CONFIG_PATH.exists() else ""
    lines = text.splitlines()

    mcp_idx = next((i for i, l in enumerate(lines) if l.rstrip() == "mcp_servers:"), None)

    to_add = []
    if mcp_idx is None:
        existing_names = set()
    else:
        existing_names = set()
        end_idx = len(lines)
        for i in range(mcp_idx + 1, len(lines)):
            line = lines[i]
            if line.strip() == "":
                continue
            indent = len(line) - len(line.lstrip(" "))
            if indent == 0:
                end_idx = i
                break
            if indent == 2 and line.rstrip().endswith(":"):
                existing_names.add(line.strip().rstrip(":"))
            end_idx = i + 1

    for name, command, args in MCP_SERVERS:
        if name in existing_names:
            continue
        resolved_args = [a.format(projects=projects_path) for a in args]
        to_add.append((name, _server_block(name, command, resolved_args)))

    if not to_add:
        return {"ok": True, "action": "already present", "servers": [n for n, _, _ in MCP_SERVERS]}

    if mcp_idx is None:
        new_text = (text.rstrip("\n") + "\n\n" if text.strip() else "") + "mcp_servers:\n" + "".join(b for _, b in to_add)
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(new_text)
        return {"ok": True, "action": "created mcp_servers block", "added": [n for n, _ in to_add]}

    insertion = "\n".join("".join(b for _, b in to_add).splitlines())
    new_lines = lines[:end_idx] + insertion.splitlines() + lines[end_idx:]
    CONFIG_PATH.write_text("\n".join(new_lines) + "\n")
    return {"ok": True, "action": "added servers", "added": [n for n, _ in to_add]}
