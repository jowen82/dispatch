import json, pathlib
from studio.recommender import recommend_models
ROOT=pathlib.Path(__file__).resolve().parents[1]
C=json.loads((ROOT/'studio/catalogs/models.json').read_text())
def test_16gb():
 r=recommend_models({'ram_gb':16,'disk_free_gb':100},C,[])
 assert r['general']['id']=='llama3.1:8b'  # long-context model — clears Hermes Agent's 64K minimum
 assert r['coder']['id']=='qwen2.5-coder:7b-instruct-q4_K_M'
 assert r['policy']['generation_parallelism']==1
