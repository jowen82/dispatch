# Architecture

The studio is separated into deterministic control-plane services and replaceable AI/runtime adapters.

- Setup/Discovery: hardware, models, tools, auth and recommendations.
- Organization Planner: selects dormant catalog roles for the project type/complexity.
- Command Center: SQLite-backed project, task, service-desk, approval, event and agent state.
- Agent Runtime Adapter: Hermes is the first target; the control plane is not hard-coupled to one runtime.
- Model Runtime: local model provider such as Ollama.
- Tool Plane: filesystem, Git/GitHub, Xcode, Playwright, Context7, Penpot and security tooling.
- Memory Plane: structured state remains in SQLite; semantic RAG is an extension point.
- Human Gate: production and sensitive decisions are never inferred from model text.

The core principle is many logical roles, few physical models. Smaller machines serialize generation work; larger machines may increase parallelism without changing the organization model.
