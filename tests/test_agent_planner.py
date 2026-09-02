import json,pathlib
from studio.agent_planner import build_org
ROOT=pathlib.Path(__file__).resolve().parents[1];C=json.loads((ROOT/'studio/catalogs/agents.json').read_text())
def test_ios_has_swift_and_security():
 o=build_org(C,'ios','medium',5,1);ids={a['id'] for a in o['agents']};assert 'swift_engineer' in ids;assert 'appsec_engineer' in ids;assert 'chief_of_staff' in ids
def test_web_not_gameplay():
 o=build_org(C,'web','small',3,1);ids={a['id'] for a in o['agents']};assert 'frontend_engineer' in ids;assert 'gameplay_engineer' not in ids
