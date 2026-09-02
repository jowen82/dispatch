from __future__ import annotations
import os, platform, shutil, subprocess, json, re
from pathlib import Path

def run(cmd, timeout=20):
    try:
        p=subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {"ok":p.returncode==0,"code":p.returncode,"stdout":p.stdout.strip(),"stderr":p.stderr.strip()}
    except Exception as e:
        return {"ok":False,"code":-1,"stdout":"","stderr":str(e)}

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

def hermes_info():
    path=shutil.which("hermes")
    cfg=Path.home()/".hermes"/"config.yaml"
    return {"installed":bool(path),"path":path,"config_path":str(cfg),"config_exists":cfg.exists(),"version":(run(["hermes","--version"],5)["stdout"] if path else "")}

def github_auth():
    if not shutil.which("gh"): return {"installed":False,"authenticated":False}
    r=run(["gh","auth","status"],10)
    return {"installed":True,"authenticated":r["ok"],"detail":(r["stdout"]+"\n"+r["stderr"]).strip()[:1200]}

def full_scan(tools_catalog):
    tools,extras=detect_tools(tools_catalog)
    return {"system":mac_info(),"tools":tools,"extras":extras,"models":ollama_models(),"hermes":hermes_info(),"github":github_auth()}
