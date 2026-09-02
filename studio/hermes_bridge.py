"""File-based audit trail for every Command Center → Hermes dispatch.

Dispatch's primary integration path is now `studio/hermes_client.py`, which
calls the real, documented `hermes send --to <profile>` CLI command. This
module is the durable side-channel that runs alongside every send: every
Command Center action (a task, ticket, approval, or project) is mirrored as
a JSON job file inside `projects/<slug>/hermes-inbox/` — the same directory
the generated `filesystem_projects` MCP server already points Hermes at
(see hermes_adapter.py) — so an agent can also just read the folder
directly. Once `hermes_client.send()` returns, its result is written to a
matching file in `hermes-outbox/` by `write_result()` below, and the
Command Center reads that back as the "Hermes result" shown on each card.

If the `hermes` CLI isn't available, jobs still queue in `hermes-inbox/`
and nothing in the UI claims a job was received until an outbox result
actually shows up.
"""
from __future__ import annotations

import json
import time
from pathlib import Path


def project_dir(home, slug: str) -> Path:
    d = Path(home) / "projects" / (slug or "general")
    (d / "hermes-inbox").mkdir(parents=True, exist_ok=True)
    (d / "hermes-outbox").mkdir(parents=True, exist_ok=True)
    return d


def dispatch(home, slug: str, kind: str, key: str, payload: dict) -> str:
    """Write (or overwrite) a job file describing the current state of one item."""
    d = project_dir(home, slug)
    job = {"kind": kind, "key": key, "queued_at": time.time(), **payload}
    path = d / "hermes-inbox" / f"{kind}-{key}.json"
    path.write_text(json.dumps(job, indent=2))
    return str(path)


def write_result(home, slug: str, kind: str, key: str, result: dict) -> str:
    """Record the outcome of a real hermes_client.send() call as an outbox result."""
    d = project_dir(home, slug)
    path = d / "hermes-outbox" / f"{kind}-{key}.result.json"
    payload = {**result, "recorded_at": time.time()}
    path.write_text(json.dumps(payload, indent=2))
    return str(path)


def check_result(home, slug: str, kind: str, key: str) -> dict | None:
    """Return the contents of a matching outbox result file, if Hermes (or a human) has dropped one."""
    d = project_dir(home, slug)
    path = d / "hermes-outbox" / f"{kind}-{key}.result.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def bridge_summary(home) -> dict:
    """Rough counts across every project's inbox/outbox, for a status widget."""
    root = Path(home) / "projects"
    queued = 0
    acknowledged = 0
    if root.exists():
        for proj in root.iterdir():
            inbox = proj / "hermes-inbox"
            outbox = proj / "hermes-outbox"
            if inbox.exists():
                queued += len(list(inbox.glob("*.json")))
            if outbox.exists():
                acknowledged += len(list(outbox.glob("*.result.json")))
    return {"queued": queued, "acknowledged": acknowledged, "verified": False}
