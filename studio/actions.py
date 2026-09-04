from __future__ import annotations
import os, platform, shutil, subprocess, threading, time, json, re
from pathlib import Path

def run(cmd,timeout=1800,env=None):
    try:
        p=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout,env=env)
        return {"ok":p.returncode==0,"code":p.returncode,"stdout":p.stdout[-12000:],"stderr":p.stderr[-12000:]}
    except Exception as e:return {"ok":False,"code":-1,"stdout":"","stderr":str(e)}

def install_brew(pkg):
    if not shutil.which("brew"): return {"ok":False,"stderr":"Homebrew is not installed."}
    return run(["brew","install",pkg])

def pull_model(model):
    if not shutil.which("ollama"): return {"ok":False,"stderr":"Ollama is not installed."}
    return run(["ollama","pull",model])

def remove_model(model):
    if not shutil.which("ollama"): return {"ok":False,"stderr":"Ollama is not installed."}
    return run(["ollama","rm",model])

def launch_terminal(command,title="Dispatch"):
    safe=command.replace('\\','\\\\').replace('"','\\"')
    script=f'tell application "Terminal" to do script "{safe}"\ntell application "Terminal" to activate'
    return run(["osascript","-e",script],timeout=15)

def github_auth():
    return launch_terminal('gh auth login --web; echo; echo "GitHub authentication flow finished. Return to Dispatch and click Verify."')

def open_url(url):
    return run(["open",url],timeout=10)

def install_hermes():
    """Fetch and run Hermes's own official installer — the same one-liner
    from hermes-agent.nousresearch.com/docs/getting-started/installation,
    per-OS. This downloads and executes a script from Nous Research's own
    domain, on the person's explicit click in the wizard (same trust model
    as clicking the same command from their docs page yourself). UNTESTED
    on real Windows hardware — the macOS/Linux path mirrors the documented
    curl-pipe-bash exactly."""
    system = platform.system()
    if system == "Windows":
        cmd = ["powershell", "-NoProfile", "-Command",
               "iex (irm https://hermes-agent.nousresearch.com/install.ps1)"]
    else:
        cmd = ["bash", "-c", "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"]
    return run(cmd, timeout=900)

def backup_hermes(home):
    cfg=Path.home()/".hermes"/"config.yaml"
    if not cfg.exists(): return {"ok":False,"stderr":"No ~/.hermes/config.yaml found"}
    backups=Path(home)/"backups";backups.mkdir(parents=True,exist_ok=True)
    dest=backups/f"hermes-config-{int(time.time())}.yaml"
    shutil.copy2(cfg,dest)
    return {"ok":True,"stdout":str(dest)}
