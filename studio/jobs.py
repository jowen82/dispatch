"""Lightweight background-job runner used to power progress bars in the UI.

Any action that can take a noticeable amount of time (a system rescan, a
Homebrew install, an Ollama model pull) is started in a background thread and
handed a job id. The frontend polls /api/job?id=<id> and renders a progress
bar with a live estimated-time-remaining figure.

There is no way to know the *true* progress of `brew install` or `ollama
pull` from the outside, so progress is modeled as an approach curve toward a
learned estimate: each job kind (and, for installs/pulls, each package or
model) keeps a rolling-average duration in the persisted setup state. The bar
advances quickly at first and eases toward ~92% as the estimate is reached,
then jumps to 100% the instant the underlying command actually finishes. The
more a person uses the app, the more accurate the estimates become.
"""
from __future__ import annotations

import math
import threading
import time
import uuid


class Job:
    def __init__(self, kind: str, label: str, estimate_seconds: float):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.label = label
        self.estimate_seconds = max(float(estimate_seconds), 1.0)
        self.started_at = time.time()
        self.finished_at = None
        self.done = False
        self.ok = None
        self.result = None

    def elapsed(self) -> float:
        return time.time() - self.started_at

    def snapshot(self) -> dict:
        elapsed = self.elapsed()
        if self.done:
            progress = 100.0
            eta = 0.0
        else:
            ratio = elapsed / self.estimate_seconds
            # Exponential approach to 92%: fast start, slows near the estimate,
            # never claims completion until the job actually reports done.
            progress = 92.0 * (1 - math.exp(-1.6 * ratio))
            eta = max(0.0, self.estimate_seconds - elapsed)
        return {
            "id": self.id,
            "kind": self.kind,
            "label": self.label,
            "done": self.done,
            "ok": self.ok,
            "result": self.result if self.done else None,
            "progress": round(min(progress, 100.0), 1),
            "eta_seconds": round(eta, 1),
            "elapsed_seconds": round(elapsed, 1),
        }


class JobManager:
    def __init__(self, state):
        self.state = state
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()

    def estimate(self, kind: str, default_seconds: float) -> float:
        durations = self.state.setup.get("durations", {})
        return float(durations.get(kind, default_seconds))

    def _record_duration(self, kind: str, seconds: float) -> None:
        durations = dict(self.state.setup.get("durations", {}))
        prev = durations.get(kind)
        # Exponential moving average so estimates improve run over run
        # without being thrown off by one unusually slow/fast run.
        durations[kind] = seconds if prev is None else (prev * 0.7 + seconds * 0.3)
        self.state.patch(durations=durations)

    def start(self, kind: str, label: str, estimate_seconds: float, fn) -> str:
        job = Job(kind, label, estimate_seconds)
        with self.lock:
            self.jobs[job.id] = job

        def runner():
            try:
                result = fn()
                job.ok = bool(result.get("ok", True)) if isinstance(result, dict) else True
                job.result = result
            except Exception as e:  # pragma: no cover - defensive
                job.ok = False
                job.result = {"ok": False, "stderr": str(e)}
            job.finished_at = time.time()
            job.done = True
            self._record_duration(kind, job.finished_at - job.started_at)

        threading.Thread(target=runner, daemon=True).start()
        return job.id

    def status(self, job_id: str) -> dict | None:
        with self.lock:
            job = self.jobs.get(job_id)
        return job.snapshot() if job else None

    def sweep(self, max_age_seconds: int = 3600) -> None:
        """Drop finished jobs older than max_age_seconds to avoid unbounded growth."""
        now = time.time()
        with self.lock:
            stale = [jid for jid, j in self.jobs.items() if j.done and j.finished_at and now - j.finished_at > max_age_seconds]
            for jid in stale:
                del self.jobs[jid]
