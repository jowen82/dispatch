from __future__ import annotations
import json,re
from pathlib import Path

def redact(s):
    if not isinstance(s,str):return s
    s=re.sub(r'(?i)(token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,]+',r'\1=[REDACTED]',s)
    s=re.sub(r'ghp_[A-Za-z0-9_]+','[REDACTED_GITHUB_TOKEN]',s)
    return s

def create(home, scan, rec, org, setup):
    p=Path(home)/"support-report.json"
    payload={"scan":scan,"recommendation":rec,"organization":{"project_type":org.get("project_type"),"complexity":org.get("complexity"),"agent_count":org.get("agent_count")},"setup":setup}
    txt=json.dumps(payload,indent=2)
    p.write_text(redact(txt))
    return str(p)
