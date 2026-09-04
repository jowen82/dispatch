from __future__ import annotations
import os, platform, shutil, subprocess, json, re
from pathlib import Path

def run(cmd, timeout=20):
    try:
        p=subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {"ok":p.returncode==0,"code":p.returncode,"stdout":p.stdout.strip(),"stderr":p.stderr.strip()}
    except Exception as e:
        return {"ok":False,"code":-1,"stdout":"","stderr":str(e)}

def _windows_ram_gb() -> float:
    """RAM via the Win32 GlobalMemoryStatusEx API through ctypes — no extra
    dependency, works on stock Windows. UNTESTED on real Windows hardware;
    verify this on an actual machine before relying on it."""
    try:
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]
        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))  # type: ignore[attr-defined]
        return round(stat.ullTotalPhys / (1024 ** 3), 1)
    except Exception:
        return 0.0

def windows_info():
    """Windows hardware detection. UNTESTED on real Windows — this mirrors
    mac_info()'s shape (chip/ram_gb/os) using WMIC/ctypes equivalents so the
    rest of Dispatch (recommender.py, agent_planner.py) doesn't need to know
    which OS it's running on. Please report back what actually happens on a
    real machine so this can be corrected."""
    chip = "Unknown CPU"
    r = run(["wmic", "cpu", "get", "name"], timeout=10)
    if r["ok"] and r["stdout"]:
        lines = [l.strip() for l in r["stdout"].splitlines() if l.strip() and l.strip().lower() != "name"]
        if lines:
            chip = lines[0]
    os_name = platform.platform()
    r2 = run(["wmic", "os", "get", "Caption"], timeout=10)
    if r2["ok"] and r2["stdout"]:
        lines = [l.strip() for l in r2["stdout"].splitlines() if l.strip() and l.strip().lower() != "caption"]
        if lines:
            os_name = lines[0]
    return {"chip": chip, "ram_gb": _windows_ram_gb(), "os": os_name}

def mac_info():
    info={"platform":platform.system(),"machine":platform.machine(),"hostname":platform.node()}
    if platform.system()=="Darwin":
        chip=run(["sysctl","-n","machdep.cpu.brand_string"])
        if not chip["ok"] or not chip["stdout"]:
            hw=run(["system_profiler","SPHardwareDataType"])
            m=re.search(r"Chip:\s*(.+)",hw["stdout"])
            chipname=m.group(1).strip() if m else "Apple Silicon"
        else: chipname=chip["stdout"]
        mem=run(["sysctl","-n","hw.memsize"])
        try: ram=round(int(mem["stdout"])/(1024**3),1)
        except: ram=0
        sw=run(["sw_vers"])
        info.update({"chip":chipname,"ram_gb":ram,"os":sw["stdout"]})
    elif platform.system()=="Windows":
        info.update(windows_info())
    du=shutil.disk_usage(Path.home())
    info.update({"disk_total_gb":round(du.total/1024**3,1),"disk_free_gb":round(du.free/1024**3,1)})
    return info

def detect_tools(catalog):
    found=[]
    for t in catalog.get("tools",[]):
        path=shutil.which(t["command"])
        version=""
        if path:
            r=run([t["command"],"--version"],timeout=5)
            version=(r["stdout"] or r["stderr"]).splitlines()[0][:160] if (r["stdout"] or r["stderr"]) else "installed"
        found.append({**t,"installed":bool(path),"path":path,"version":version})
    extras=[]
    for cmd in ["brew","ollama","hermes","xcodebuild","xcrun","lms","python3","npm","npx"]:
        path=shutil.which(cmd)
        extras.append({"id":cmd,"command":cmd,"installed":bool(path),"path":path})
    return found,extras

def ollama_models():
    if not shutil.which("ollama"): return []
    r=run(["ollama","list"],timeout=20)
    if not r["ok"]: return []
    lines=r["stdout"].splitlines()
    if len(lines)<2:return []
    result=[]
    for line in lines[1:]:
        parts=re.split(r"\s{2,}",line.strip())
        if parts:
            result.append({"name":parts[0],"id":parts[1] if len(parts)>1 else "","size":parts[2] if len(parts)>2 else "","modified":parts[3] if len(parts)>3 else ""})
    return result

# Hermes Agent hard-refuses to initialize any model below this context window,
# regardless of how well it fits available RAM (confirmed against a real
# "agent init failed" error: a model reporting 40,960 tokens was rejected
# with "below the minimum 64,000 required by Hermes Agent"). Any local model
# Dispatch wires up as Hermes's main model must clear this floor.
HERMES_MIN_CONTEXT_TOKENS = 64000

def ollama_context_length(model_name: str) -> int | None:
    """Query `ollama show <model>` for the context window Ollama actually
    configured for this model, in tokens. Returns None — meaning "could not
    verify", never "meets the minimum" — if ollama isn't on PATH, the model
    isn't pulled yet, or the CLI's output doesn't match the expected
    'context length   <n>' line (format may vary across Ollama versions)."""
    if not shutil.which("ollama"):
        return None
    r = run(["ollama", "show", model_name], timeout=15)
    if not r["ok"]:
        return None
    m = re.search(r"context\s+length\s+(\d+)", r["stdout"], re.I)
    return int(m.group(1)) if m else None

def _gguf_size_gb(path: Path) -> float:
    try:
        return round(path.stat().st_size / (1024 ** 3), 2)
    except OSError:
        return 0.0

def _scan_gguf_dir(root: Path, runtime: str) -> list[dict]:
    if not root.exists():
        return []
    out = []
    try:
        for f in root.rglob("*.gguf"):
            out.append({
                "name": f.stem,
                "id": f.stem,
                "runtime": runtime,
                "path": str(f),
                "disk_gb": _gguf_size_gb(f),
            })
    except OSError:
        pass
    return out

def lmstudio_models() -> list[dict]:
    """LM Studio stores downloaded GGUF models under a per-OS cache dir
    regardless of whether the `lms` CLI is on PATH."""
    home = Path.home()
    candidates = [
        home / ".cache" / "lm-studio" / "models",
        home / ".lmstudio" / "models",
        home / "AppData" / "Roaming" / "LM Studio" / "models",  # Windows
    ]
    seen, out = set(), []
    for root in candidates:
        for m in _scan_gguf_dir(root, "lmstudio"):
            if m["path"] not in seen:
                seen.add(m["path"])
                out.append(m)
    return out

def llamacpp_models() -> list[dict]:
    """Best-effort scan of common folders people point llama.cpp / GPT4All /
    text-generation-webui style local runners at. There's no single standard
    location, so this only ever adds models — never assumes absence means
    nothing is installed."""
    home = Path.home()
    candidates = [
        home / "models",
        home / "Models",
        home / ".cache" / "llama.cpp",
        home / "llama.cpp" / "models",
        home / ".cache" / "gpt4all",
    ]
    seen, out = set(), []
    for root in candidates:
        for m in _scan_gguf_dir(root, "llamacpp"):
            if m["path"] not in seen:
                seen.add(m["path"])
                out.append(m)
    return out

def all_local_models() -> dict:
    """Every local model Dispatch could find, grouped by the runtime that
    would serve it. Ollama models are already pulled via `ollama list`;
    LM Studio / llama.cpp-style runners are found by scanning their usual
    model folders for .gguf files (no daemon needs to be running)."""
    return {
        "ollama": ollama_models(),
        "lmstudio": lmstudio_models(),
        "llamacpp": llamacpp_models(),
    }

def hermes_info():
    path=shutil.which("hermes")
    cfg=Path.home()/".hermes"/"config.yaml"
    return {"installed":bool(path),"path":path,"config_path":str(cfg),"config_exists":cfg.exists(),"version":(run(["hermes","--version"],5)["stdout"] if path else "")}

def github_auth():
    if not shutil.which("gh"): return {"installed":False,"authenticated":False}
    r=run(["gh","auth","status"],10)
    return {"installed":True,"authenticated":r["ok"],"detail":(r["stdout"]+"\n"+r["stderr"]).strip()[:1200]}

def full_scan(tools_catalog):
    from . import harnesses
    tools,extras=detect_tools(tools_catalog)
    return {"system":mac_info(),"tools":tools,"extras":extras,"models":ollama_models(),"local_models":all_local_models(),"hermes":hermes_info(),"github":github_auth(),"harnesses":harnesses.detect()}
