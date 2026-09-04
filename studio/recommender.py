from __future__ import annotations
import re
from . import discovery

def recommend_models(system, catalog, installed):
    ram=float(system.get("ram_gb") or 0)
    free=float(system.get("disk_free_gb") or 0)
    rec={}
    for role in ["general","coder","embedding"]:
        candidates=[m for m in catalog["models"] if m["role"]==role and m["ram_ideal_gb"]<=max(ram,4)]
        if not candidates:
            candidates=[m for m in catalog["models"] if m["role"]==role and m["ram_min_gb"]<=max(ram,4)]
        if candidates:
            candidates.sort(key=lambda x:(x["quality"]*0.65+x["speed"]*0.35),reverse=True)
            rec[role]=candidates[0]
    existing_names={m["name"] for m in installed}
    for role,m in rec.items():
        m["installed"]=m["id"] in existing_names
        m["action"]="keep" if m["installed"] else "install"
    rec["policy"]={
        "max_context":8192 if ram>=16 else 4096,
        "routine_context":4096,
        "generation_parallelism":1 if ram<32 else 2,
        "prefer_single_generation_model_resident":ram<32,
        "estimated_additional_disk_gb":round(sum(m["disk_gb"] for k,m in rec.items() if k in {"general","coder","embedding"} and not m.get("installed")),1)
    }
    rec["storage_ok"]=free > rec["policy"]["estimated_additional_disk_gb"]+20
    return rec

_PARAM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z])")

def _estimate_ram_need_gb(name: str, disk_gb: float) -> float:
    """Rough RAM headroom a local model needs to run comfortably, estimated
    from its filename (param count, e.g. '7b'/'13b'/'70b') when present,
    falling back to its file size on disk (a quantized GGUF's size is a
    decent proxy for the RAM/VRAM it needs at inference time) otherwise.
    This is a fit heuristic, not a benchmarked quality score — Dispatch has
    no way to know how good an arbitrary model on your disk actually is."""
    m = _PARAM_RE.search(name or "")
    if m:
        params_b = float(m.group(1))
        return round(params_b * 1.2, 1)  # ~1.2GB of RAM per 1B params at common quantizations
    return round(max(disk_gb, 0.5) * 1.3, 1)  # file size + working headroom


def rank_all_local_models(system, local_models: dict) -> list[dict]:
    """Flatten every local model Dispatch found (Ollama, LM Studio, llama.cpp-
    style folders) into one list, ranked best-to-worst for THIS machine by how
    well each one fits available RAM — not by benchmarked quality, since
    Dispatch can't score an arbitrary GGUF's actual output quality. A model
    that uses most of your RAM without exceeding it ranks above one that
    barely uses any (wasted capability) or one that would thrash/OOM."""
    ram = float(system.get("ram_gb") or 0)
    usable_ram = max(ram - 4, 2)  # leave headroom for the OS and Hermes itself
    flat = []
    for runtime, models in (local_models or {}).items():
        for m in models:
            disk_gb = float(m.get("disk_gb") or 0)
            # Ollama's `ollama list` reports size like "4.7 GB" as a string, not disk_gb.
            if not disk_gb and isinstance(m.get("size"), str):
                sm = re.search(r"([\d.]+)\s*GB", m["size"], re.I)
                disk_gb = float(sm.group(1)) if sm else 0.0
            need = _estimate_ram_need_gb(m.get("name") or m.get("id") or "", disk_gb)
            if need <= usable_ram:
                fit, headroom_ratio = "comfortable", need / usable_ram if usable_ram else 1
                if headroom_ratio > 0.85:
                    fit = "tight"
            else:
                fit = "wont_fit"
            context_length = None
            if runtime == "ollama":
                # Only Ollama exposes this via `ollama show`; LM Studio/llama.cpp
                # folders are left unknown rather than guessed at.
                context_length = discovery.ollama_context_length(m.get("name") or m.get("id") or "")
            flat.append({
                **m, "runtime": runtime, "estimated_ram_gb": need, "fit": fit,
                "context_length": context_length,
                "meets_hermes_min_context": (
                    None if context_length is None
                    else context_length >= discovery.HERMES_MIN_CONTEXT_TOKENS
                ),
            })
    fit_rank = {"comfortable": 0, "tight": 1, "wont_fit": 2}
    # Within "fits" models, prefer the one that uses the most of your machine
    # (bigger models are generally more capable) without tipping into "tight".
    flat.sort(key=lambda m: (fit_rank[m["fit"]], -m["estimated_ram_gb"] if m["fit"] != "wont_fit" else m["estimated_ram_gb"]))
    return flat


def evaluate_existing(installed,recommendation):
    wanted={recommendation[k]["id"] for k in ["general","coder","embedding"] if k in recommendation}
    out=[]
    for m in installed:
        out.append({**m,"recommended":m["name"] in wanted,"suggestion":"KEEP" if m["name"] in wanted else "REVIEW"})
    return out
