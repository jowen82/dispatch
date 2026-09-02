#!/bin/zsh
set -u
ROOT="${1:-.}";cd "$ROOT"||exit 2;FAILED=0
command -v gitleaks >/dev/null && gitleaks detect --source . --no-banner --redact || FAILED=1
command -v osv-scanner >/dev/null && osv-scanner scan source -r . || FAILED=1
command -v semgrep >/dev/null && semgrep scan --config auto --error --metrics=off . || FAILED=1
[[ "$FAILED" -eq 0 ]] && { echo SECURITY_GATE=PASS; exit 0; }
echo SECURITY_GATE=FAIL;exit 1
