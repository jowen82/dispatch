from __future__ import annotations

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

def evaluate_existing(installed,recommendation):
    wanted={recommendation[k]["id"] for k in ["general","coder","embedding"] if k in recommendation}
    out=[]
    for m in installed:
        out.append({**m,"recommended":m["name"] in wanted,"suggestion":"KEEP" if m["name"] in wanted else "REVIEW"})
    return out
