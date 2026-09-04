# Dispatch

A local-first setup and command-center package for building an adaptive autonomous software-development organization on macOS. It discovers hardware, installed local models and developer tools; recommends a lean model/runtime configuration; installs only missing dependencies after approval; generates a project-specific agent organization; and provides a local GUI for setup, service-desk tickets, approvals, project state and health.

## What this package does today

- Detects macOS hardware, RAM, free disk, Xcode, Homebrew, Ollama, Hermes, Git/GitHub CLI, Node and security tools, with a live progress bar and estimated time remaining while the scan runs.
- Detects Ollama models and recommends general, coding and embedding models based on available unified memory.
- Also finds every other local model on the machine — LM Studio and llama.cpp-style model folders, not just Ollama — and ranks all of them best-to-worst by how well each one fits your available RAM (a fit ranking, not a benchmarked quality score). Ollama models are also checked against Hermes Agent's own hard 64,000-token context minimum and flagged "Too short for Hermes" if they fall short (the default Qwen3 dense models on Ollama report 40,960 tokens and fail this check) — Dispatch's own recommended general-purpose model was corrected to a long-context Llama 3.x/Mistral Nemo model for exactly this reason, and it verifies the actual pulled model's context at setup time before wiring it into Hermes rather than assuming the catalog is still accurate.
- Never deletes a model without an explicit confirmation.
- Installs missing Homebrew tools and pulls recommended Ollama models from the GUI, each with a progress bar and an ETA that improves the more you use it (it learns from your own install/pull history).
- Opens GitHub authentication in Terminal/browser and verifies the result.
- Lets you pick every deployment target you're shipping to (iOS, macOS, web, Android, game, full-stack, AI/ML) as multi-select cards, then decides organization size and complexity for you — that's not a dial you manage.
- Uses a large dormant agent catalog and activates only roles applicable to the selected deployment target(s).
- Persists setup state and resumes after restart.
- Finishes the Setup Wizard by activating the roster and opening the Command Center in its own window/tab, separate from the wizard.
- The Command Center is the ongoing home for everything else: a drag-and-drop kanban board, agents, service-desk tickets, approvals, projects, models, tools, Hermes integration status and diagnostics.
- Projects have a real detail view — click a card to read/edit its description, see when it was created, assign or remove agents, archive it, or delete it.
- Lets you choose during setup whether your agents run on local Ollama models, hosted frontier models (Anthropic, OpenAI, OpenRouter, xAI, MiniMax, Gemini), or a hybrid of both per role.
- When the `hermes` CLI is on PATH, finishing setup configures Hermes for real, non-interactively, with no manual steps: it merges Dispatch's MCP servers (filesystem, context7, playwright, penpot) into `~/.hermes/config.yaml` (backing it up first, and only ever adding servers you don't already have — never touching anything else in the file), points the main model at local Ollama or your chosen frontier provider via the documented `hermes config set` command, and creates a cloned Hermes profile per agent so every role starts with that same config already applied. In hybrid mode, per-role frontier overrides are applied on top of each agent's profile individually. If the CLI isn't available, the wizard falls back to step-by-step manual instructions mapped to the exact screen Hermes shows on first launch, plus a generated checklist.
- Walks through Hermes setup for both a fresh install and an already-installed config, as separate instruction tracks.
- Talks to a locally running Hermes Agent for real: every Command Center action (tasks, tickets, approvals, project files) is sent live with `hermes send --to <agent>`. Each card shows whether Hermes actually received it, not just that it was queued.
- Creating a project immediately sends its description to Hermes as a real kickoff prompt telling it to start working now — including the exact `POST /api/task` and `/api/task-update` calls Hermes should make against Dispatch's own local API so its own progress shows up on the Command Center Kanban board as it works, not just after the fact. A project only flips from "planning" to "in_progress" once that dispatch actually succeeds, and a "Send to Hermes" button on the project's detail view lets you resend the same prompt on demand (e.g. after editing it, or after Hermes wasn't running the first time).
- Also mirrors every action into a durable `projects/<slug>/hermes-inbox/`/`hermes-outbox/` file-based audit trail (the same folder the generated filesystem MCP server points Hermes at), so nothing is lost if Hermes isn't running when an action happens — and this fallback still works even without the CLI installed.
- Generates Hermes integration files safely without overwriting an unknown Hermes configuration.
- Produces a diagnostic/support report with common secrets redacted.
- If Hermes isn't installed, the wizard can fetch and run its official installer for you with one click (macOS/Linux verified against the documented one-liner; Windows via its `install.ps1` is included but not yet tested on real Windows hardware).
- Detects and ranks other agent harnesses beyond Hermes — OpenClaw and DeepSeek Harness are detected (not yet auto-configured the way Hermes is); Grok Bot is listed for comparison but has no local config surface Dispatch can drive.
- Experimental Windows support: hardware detection and a PowerShell `bootstrap.ps1`/`run.ps1` pair mirroring the macOS flow. Untested on real Windows — please report back what breaks.
- Redesigned Setup Wizard: a split-screen layout with your fields on the left and a live-updating visual breakdown of what you're configuring on the right, plus smooth transitions between steps. Finishing setup now transitions straight into the Command Center in the same window (no more pop-up tab), and the old manual Hermes setup instructions are gone since that's fully automatic now — a lightweight fallback stays for when the CLI isn't available.
- Redesigned Command Center: a dashboard-style overview with stat cards; a Kanban board with a right-hand panel showing % complete and per-status counts for the selected project; a Service Desk with a ticket list and a detail panel (status, problem, and a real activity timeline) instead of plain cards; an Agents view rebuilt as a department-grouped org chart that actually lights up an agent when Dispatch just dispatched it something (a real signal, not a simulated one); and a Projects view grouped into Planning / In Progress / Archived columns with a summary panel and per-project task-completion bars. The old Tools & Integration and Diagnostics tabs are consolidated into one lean Settings view, reached from the sidebar rather than the main nav.
- A small, unobtrusive GitHub link (with a star prompt) sits in the corner of both the Setup Wizard and the Command Center.

## Important boundary

Dispatch does write to your real `~/.hermes/config.yaml` when it auto-configures Hermes, but conservatively: it always backs the file up first, and it only ever *adds* its own MCP servers and model settings via the documented `hermes config set` command — it never deletes or rewrites anything else already in your config. Secrets (frontier API keys) go straight into Hermes's own `.env` the same way, never into Dispatch's local state.

Live dispatch depends on the `hermes` CLI being on PATH and (for the liveness pill in the Command Center) `hermes serve` running locally. Without the CLI, every action still queues in the file-based `hermes-inbox/` audit trail — nothing is lost, it just isn't sent automatically.

## Run

Double-click `bootstrap.command` in Finder, or run:

```bash
chmod +x bootstrap.command
./bootstrap.command
```

The bootstrap opens the setup GUI in your browser at `http://127.0.0.1:8787`.

Setup state is stored under `~/Dispatch/` and can be resumed by running `run.command`.

> **Upgrading from an earlier build (Local Development Studio / Local AI Dev Studio)?** The app is now called **Dispatch** and the state directory moved to `~/Dispatch/`. Copy your old `studio.db` and `setup-state.json` into the new folder to carry your data forward, or just re-run the Setup Wizard.
