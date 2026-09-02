"""Builds the adaptive agent organization for the selected deployment target(s).

v0.2 change: complexity and "major features" are no longer user-editable
dials. A person picks the deployment type(s) they're shipping to (one or more
cards) and the studio decides how big the organization needs to be. This
keeps the tool honest about what those numbers meant in the first place -
they were rough proxies for scope that most people had no principled way to
answer, so we estimate scope from the shape of the selection instead:
more deployment targets and inherently broader project types (full stack,
game) imply more coordination and more specialist roles.
"""
from __future__ import annotations

LEVEL = {"minimal": 0, "small": 1, "medium": 2, "large": 3, "enterprise": 4}
ACTIVATION_RANK = {"always": 0, "small": 1, "medium": 2, "large": 3, "enterprise": 4}

# Baseline "shape of scope" per project type, used only to auto-size the
# organization - never shown to the user as an editable number.
TYPE_WEIGHT = {
    "ios": 0,
    "macos": 0,
    "android": 0,
    "web": 1,
    "game": 3,
    "ai_ml": 2,
    "fullstack": 4,
}


def resolve_complexity(project_types: list[str]) -> str:
    types = project_types or ["ios"]
    score = sum(TYPE_WEIGHT.get(t, 1) for t in types)
    # Shipping to multiple targets at once adds real coordination overhead.
    score += max(0, len(types) - 1) * 3
    if score <= 2:
        return "small"
    if score <= 7:
        return "medium"
    return "large"


def build_org(catalog, project_types, complexity="auto", features=None, platforms=None):
    """project_types: a list of one or more catalog project type ids.

    `complexity`, `features`, and `platforms` are accepted for backward
    compatibility (and for tests / scripted use) but are derived
    automatically whenever `complexity` is left as "auto", which is the only
    mode the UI exposes.
    """
    if isinstance(project_types, str):
        project_types = [project_types]
    project_types = [t for t in (project_types or []) if t] or ["ios"]

    resolved = resolve_complexity(project_types) if complexity == "auto" else complexity
    threshold = LEVEL[resolved]

    selected = []
    seen_ids = set()
    for agent in catalog["agents"]:
        if not any(t in agent["project_types"] for t in project_types):
            continue
        need = ACTIVATION_RANK.get(agent.get("activation", "always"), 0)
        if need <= threshold and agent["id"] not in seen_ids:
            selected.append(agent)
            seen_ids.add(agent["id"])

    ids = {a["id"] for a in selected}
    fixed = []
    for a in selected:
        if a.get("reports_to") and a["reports_to"] not in ids:
            a = a.copy()
            a["reports_to"] = "chief_of_staff"
        fixed.append(a)

    return {
        "project_types": project_types,
        # Kept for compatibility with any code/tests still reading a single value.
        "project_type": project_types[0],
        "complexity": resolved,
        "agent_count": len(fixed),
        "agents": fixed,
    }
