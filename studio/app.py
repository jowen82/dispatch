from __future__ import annotations
import argparse, base64, json, mimetypes, threading, time, webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# Attachments larger than this are rejected outright — this server has no
# streaming multipart parser, everything comes in as one base64 JSON body.
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

from .state import State
from .discovery import full_scan
from .recommender import recommend_models, evaluate_existing
from .agent_planner import build_org
from . import actions
from .hermes_adapter import generate, integration_status
from .report import create as create_report
from .jobs import JobManager
from . import hermes_bridge
from . import hermes_client

# Rough throughput assumption used only to seed the very first ETA for a
# model pull, before we have a learned average for that specific model.
ASSUMED_PULL_MBPS = 30
DEFAULT_INSTALL_SECONDS = 25
DEFAULT_RESCAN_SECONDS = 5


class App:
    def __init__(self, package_root, home):
        self.root = Path(package_root)
        self.home = Path(home)
        self.home.mkdir(parents=True, exist_ok=True)
        self.state = State(self.home)
        self.jobs = JobManager(self.state)
        self.models = json.loads((self.root / 'studio/catalogs/models.json').read_text())
        self.tools = json.loads((self.root / 'studio/catalogs/tools.json').read_text())
        self.agents = json.loads((self.root / 'studio/catalogs/agents.json').read_text())
        self.scan = {}
        self.rec = {}
        self.org = {}
        self.log = []
        self.state.ensure_default_project()

    # --- core operations -------------------------------------------------
    def rescan(self):
        self.scan = full_scan(self.tools)
        self.rec = recommend_models(self.scan['system'], self.models, self.scan['models'])
        if not self.org:
            saved_types = self.state.setup.get('project_types') or ['ios']
            self.org = build_org(self.agents, saved_types, 'auto')
        self.state.patch(
            last_scan=int(time.time()),
            recommendation=self.rec,
            project_types=self.org['project_types'],
            complexity=self.org['complexity'],
        )
        return self.snapshot()

    def snapshot(self):
        return {
            'scan': self.scan,
            'recommendation': self.rec,
            'existing_models': evaluate_existing(self.scan.get('models', []), self.rec) if self.rec else [],
            'organization': self.org,
            'setup': self.state.setup,
            'integration': integration_status(),
            'logs': self.log[-100:],
        }

    def record(self, msg, res=None):
        self.log.append({'time': time.strftime('%H:%M:%S'), 'message': msg, 'result': res})
        return res

    def plan(self, payload):
        """Deployment-type selection drives the org. Complexity is always auto."""
        types = payload.get('project_types') or ([payload['project_type']] if payload.get('project_type') else ['ios'])
        types = [t for t in types if t] or ['ios']
        self.org = build_org(self.agents, types, 'auto')
        self.state.patch(project_types=types, complexity=self.org['complexity'])
        return self.org

    def apply_org(self):
        hermes_available = hermes_client.available()
        created, refreshed, failed = [], [], []
        for a in self.org.get('agents', []):
            self.state.exec(
                "INSERT OR REPLACE INTO agents(id,name,department,level,model_capability,status,activity) VALUES(?,?,?,?,?,'idle','Ready')",
                (a['id'], a['name'], a['department'], a['level'], a['model_capability']),
            )
            if hermes_available:
                already_had_profile = hermes_client.profile_exists(a['id'])
                res = hermes_client.create_profile(a['id'], hermes_client.build_persona(a))
                if res.get('ok'):
                    (refreshed if already_had_profile else created).append(a['id'])
                else:
                    failed.append({'agent': a['id'], 'stderr': res.get('stderr')})
        result = {'ok': True, 'count': len(self.org.get('agents', []))}
        if hermes_available:
            result['hermes_profiles'] = {'created': created, 'refreshed': refreshed, 'failed': failed}
            self.record('apply-org: created Hermes profiles', result['hermes_profiles'])
        else:
            result['hermes_profiles'] = None
        return result

    def cc(self):
        self.state.ensure_default_project()
        slugs = {p['id']: p['slug'] for p in self.state.rows('SELECT id,slug FROM projects')}
        tasks = self.state.rows('SELECT * FROM tasks ORDER BY id DESC')
        tickets = self.state.rows('SELECT * FROM tickets ORDER BY id DESC')
        approvals = self.state.rows('SELECT * FROM approvals ORDER BY id DESC')
        files = self.state.rows('SELECT id,project_id,key,filename,content_type,size_bytes,note,agent,created_at FROM project_files ORDER BY id DESC')
        for kind, rows in (('task', tasks), ('ticket', tickets), ('approval', approvals), ('file', files)):
            for r in rows:
                r['hermes_result'] = hermes_bridge.check_result(self.home, slugs.get(r.get('project_id')), kind, r['key'])
        return {
            'projects': self.state.rows('SELECT * FROM projects ORDER BY id DESC'),
            'tasks': tasks,
            'tickets': tickets,
            'approvals': approvals,
            'files': files,
            'events': self.state.rows('SELECT * FROM events ORDER BY id DESC LIMIT 100'),
            'agents': self.state.rows('SELECT * FROM agents ORDER BY department,name'),
            'project_agents': self.state.rows('SELECT * FROM project_agents'),
            'organization': self.org,
            'recommendation': self.rec,
            'scan': self.scan,
            'integration': integration_status(),
            'hermes_bridge': hermes_bridge.bridge_summary(self.home),
            'hermes_live': {'cli_available': hermes_client.available(), 'serve': hermes_client.serve_status() if hermes_client.available() else None},
            'logs': self.log[-100:],
        }

    def _project_slug(self, project_id):
        row = self.state.rows('SELECT slug FROM projects WHERE id=?', (project_id,))
        return row[0]['slug'] if row else 'general'

    # --- long-running / job-backed operations -----------------------------
    def start_rescan_job(self):
        estimate = self.jobs.estimate('rescan', DEFAULT_RESCAN_SECONDS)
        job_id = self.jobs.start('rescan', 'Rescanning this Mac', estimate, self._job_rescan)
        return {'job_id': job_id}

    def _job_rescan(self):
        self.rescan()
        return {'ok': True}

    def start_install_tool_job(self, package):
        kind = f'install:{package}'
        estimate = self.jobs.estimate(kind, DEFAULT_INSTALL_SECONDS)
        job_id = self.jobs.start('install_tool', f'Installing {package}', estimate, lambda: self._job_install_tool(package))
        return {'job_id': job_id}

    def _job_install_tool(self, package):
        res = actions.install_brew(package)
        self.record('install tool ' + str(package), res)
        self.rescan()
        return res

    def start_pull_model_job(self, model):
        kind = f'pull:{model}'
        catalog_hit = next((m for m in self.models.get('models', []) if m['id'] == model), None)
        default_estimate = (catalog_hit['disk_gb'] * 1024 / ASSUMED_PULL_MBPS) if catalog_hit else 90
        estimate = self.jobs.estimate(kind, default_estimate)
        job_id = self.jobs.start('pull_model', f'Pulling {model}', estimate, lambda: self._job_pull_model(model))
        return {'job_id': job_id}

    def _job_pull_model(self, model):
        res = actions.pull_model(model)
        self.record('pull model ' + str(model), res)
        self.rescan()
        return res

    def job_status(self, job_id):
        return self.jobs.status(job_id)

    # --- kanban / tasks -----------------------------------------------------
    def create_task(self, data):
        project_id = int(data.get('project_id') or self.state.ensure_default_project())
        key = self.state.next_key('tasks', 'TASK')
        title = data.get('title', 'Untitled task')
        status = data.get('status', 'backlog')
        priority = data.get('priority', 'P3')
        agent = data.get('agent')
        i = self.state.exec(
            "INSERT INTO tasks(project_id,key,title,status,priority,agent) VALUES(?,?,?,?,?,?)",
            (project_id, key, title, status, priority, agent),
        )
        self._dispatch_to_hermes(project_id, 'task', key, {
            'title': title, 'status': status, 'priority': priority, 'agent': agent,
            'prompt': f"New task '{title}' (priority {priority}){' assigned to ' + agent if agent else ''}. "
                      f"Update its status on the Command Center kanban board when picked up or completed.",
        })
        return {'ok': True, 'id': i, 'key': key}

    def update_task(self, data):
        key = data.get('key')
        if not key:
            return {'ok': False, 'stderr': 'Missing task key'}
        fields, args = [], []
        for col in ('status', 'agent', 'priority', 'title', 'branch'):
            if col in data:
                fields.append(f"{col}=?")
                args.append(data[col])
        if not fields:
            return {'ok': False, 'stderr': 'Nothing to update'}
        fields.append("updated_at=CURRENT_TIMESTAMP")
        args.append(key)
        self.state.exec(f"UPDATE tasks SET {','.join(fields)} WHERE key=?", tuple(args))
        row = self.state.rows('SELECT * FROM tasks WHERE key=?', (key,))
        if row:
            t = row[0]
            self._dispatch_to_hermes(t['project_id'], 'task', key, {
                'title': t['title'], 'status': t['status'], 'priority': t['priority'], 'agent': t['agent'],
                'prompt': f"Task '{t['title']}' was updated: status is now {t['status']}"
                          f"{', assigned to ' + t['agent'] if t['agent'] else ''}.",
            })
        return {'ok': True}

    def _dispatch_to_hermes(self, project_id, kind, key, payload):
        """Mirror a Command Center action to Hermes: a durable inbox file (audit trail,
        see hermes_bridge.py) plus, when the `hermes` CLI is available, a real
        `hermes send --to <agent>` call whose result is recorded as the outbox result."""
        slug = self._project_slug(project_id)
        try:
            hermes_bridge.dispatch(self.home, slug, kind, key, payload)
        except Exception as e:  # never let the audit trail break the actual feature
            self.record(f'hermes inbox write failed for {kind} {key}', {'ok': False, 'stderr': str(e)})

        prompt = payload.get('prompt')
        if not prompt:
            return
        target = payload.get('agent') or 'chief_of_staff'
        if hermes_client.available():
            result = hermes_client.send(target, prompt)
        else:
            result = {'ok': False, 'stderr': 'hermes CLI not found on PATH — queued in hermes-inbox/ only.'}
        result['target'] = target
        try:
            hermes_bridge.write_result(self.home, slug, kind, key, result)
        except Exception as e:
            self.record(f'hermes outbox write failed for {kind} {key}', {'ok': False, 'stderr': str(e)})

    # --- projects ------------------------------------------------------------
    def update_project(self, data):
        pid = data.get('id')
        if not pid:
            return {'ok': False, 'stderr': 'Missing project id'}
        fields, args = [], []
        for col in ('name', 'description', 'project_type', 'status'):
            if col in data:
                fields.append(f"{col}=?")
                args.append(data[col])
        if not fields:
            return {'ok': False, 'stderr': 'Nothing to update'}
        args.append(int(pid))
        self.state.exec(f"UPDATE projects SET {','.join(fields)} WHERE id=?", tuple(args))
        return {'ok': True}

    def archive_project(self, data):
        pid = data.get('id')
        if not pid:
            return {'ok': False, 'stderr': 'Missing project id'}
        archive = data.get('archived', True)
        if archive:
            self.state.exec("UPDATE projects SET status='archived', archived_at=CURRENT_TIMESTAMP WHERE id=?", (int(pid),))
        else:
            self.state.exec("UPDATE projects SET status='active', archived_at=NULL WHERE id=?", (int(pid),))
        return {'ok': True}

    def delete_project(self, data):
        pid = data.get('id')
        if not pid:
            return {'ok': False, 'stderr': 'Missing project id'}
        pid = int(pid)
        remaining = self.state.rows("SELECT COUNT(*) AS n FROM projects WHERE id!=?", (pid,))[0]['n']
        if remaining == 0:
            return {'ok': False, 'stderr': 'At least one project must remain — archive it instead of deleting the last one.'}
        self.state.exec("DELETE FROM projects WHERE id=?", (pid,))
        # Tasks/tickets/approvals keep their project_id as history; they simply lose a live parent.
        return {'ok': True}

    def assign_agent(self, data):
        pid = data.get('project_id')
        agent_id = data.get('agent_id')
        if not pid or not agent_id:
            return {'ok': False, 'stderr': 'Missing project_id or agent_id'}
        if data.get('assigned', True):
            self.state.exec("INSERT OR IGNORE INTO project_agents(project_id,agent_id) VALUES(?,?)", (int(pid), agent_id))
        else:
            self.state.exec("DELETE FROM project_agents WHERE project_id=? AND agent_id=?", (int(pid), agent_id))
        return {'ok': True}

    # --- project attachments --------------------------------------------------
    def add_project_file(self, data):
        """Save an uploaded file (image, doc, whatever) against a project, then
        hand it to the assigned/target Hermes agent the same way any other
        Command Center action is dispatched."""
        pid = data.get('project_id')
        filename = (data.get('filename') or 'upload.bin').strip() or 'upload.bin'
        b64 = data.get('data_base64')
        if not pid or not b64:
            return {'ok': False, 'stderr': 'Missing project_id or file data'}
        pid = int(pid)
        try:
            raw = base64.b64decode(b64, validate=False)
        except Exception as e:
            return {'ok': False, 'stderr': f'Could not decode file data: {e}'}
        if len(raw) > MAX_ATTACHMENT_BYTES:
            return {'ok': False, 'stderr': f'File is larger than the {MAX_ATTACHMENT_BYTES // (1024*1024)}MB limit.'}

        slug = self._project_slug(pid)
        key = self.state.next_key('project_files', 'FILE')
        safe_name = ''.join(c for c in filename if c.isalnum() or c in '._- ') or 'upload.bin'
        attach_dir = self.home / 'projects' / slug / 'attachments'
        attach_dir.mkdir(parents=True, exist_ok=True)
        stored_path = attach_dir / f'{key}-{safe_name}'
        stored_path.write_bytes(raw)

        content_type = data.get('content_type') or mimetypes.guess_type(safe_name)[0] or 'application/octet-stream'
        note = data.get('note', '')
        agent = data.get('agent')
        self.state.exec(
            "INSERT INTO project_files(project_id,key,filename,content_type,size_bytes,note,agent,stored_path) VALUES(?,?,?,?,?,?,?,?)",
            (pid, key, safe_name, content_type, len(raw), note, agent, str(stored_path)),
        )
        prompt = (
            f"New file uploaded to the project: '{safe_name}' ({content_type}, {len(raw)} bytes). "
            f"{('Note: ' + note + '. ') if note else ''}"
            f"It's saved at projects/{slug}/attachments/{key}-{safe_name} (reachable through the filesystem MCP server). "
            f"Review it and work with it as needed for this project."
        )
        self._dispatch_to_hermes(pid, 'file', key, {
            'filename': safe_name, 'content_type': content_type, 'size_bytes': len(raw),
            'note': note, 'agent': agent, 'prompt': prompt,
        })
        return {'ok': True, 'key': key, 'filename': safe_name, 'size_bytes': len(raw)}

    def delete_project_file(self, data):
        key = data.get('key')
        if not key:
            return {'ok': False, 'stderr': 'Missing file key'}
        row = self.state.rows('SELECT * FROM project_files WHERE key=?', (key,))
        if not row:
            return {'ok': False, 'stderr': 'Unknown file key'}
        try:
            Path(row[0]['stored_path']).unlink(missing_ok=True)
        except Exception:
            pass
        self.state.exec('DELETE FROM project_files WHERE key=?', (key,))
        return {'ok': True}


APP: App | None = None


class H(BaseHTTPRequestHandler):
    def sendj(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def body(self):
        n = int(self.headers.get('Content-Length', '0'))
        return json.loads(self.rfile.read(n) or b'{}')

    def query(self):
        return parse_qs(urlparse(self.path).query)

    def serve_static(self, filename):
        f = APP.root / 'studio/static' / filename
        if f.exists() and f.is_file():
            b = f.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
            self.send_header('Content-Length', str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return True
        return False

    def do_GET(self):
        p = urlparse(self.path).path
        if p == '/api/state':
            return self.sendj(APP.snapshot())
        if p == '/api/scan':
            # Synchronous fallback, kept for scripts/tests. The UI uses /api/scan/start.
            return self.sendj(APP.rescan())
        if p == '/api/job':
            job_id = (self.query().get('id') or [None])[0]
            status = APP.job_status(job_id) if job_id else None
            if status is None:
                return self.sendj({'error': 'unknown job'}, 404)
            return self.sendj(status)
        if p == '/api/command-center':
            return self.sendj(APP.cc())
        if p == '/api/project-file/download':
            key = (self.query().get('key') or [None])[0]
            row = APP.state.rows('SELECT * FROM project_files WHERE key=?', (key,)) if key else []
            if not row:
                return self.send_error(404)
            f = Path(row[0]['stored_path'])
            if not f.exists():
                return self.send_error(404)
            b = f.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', row[0]['content_type'] or 'application/octet-stream')
            self.send_header('Content-Length', str(len(b)))
            self.send_header('Content-Disposition', f'inline; filename="{row[0]["filename"]}"')
            self.end_headers()
            self.wfile.write(b)
            return
        if p == '/api/report':
            path = create_report(APP.home, APP.scan, APP.rec, APP.org, APP.state.setup)
            return self.sendj({'ok': True, 'path': path})
        if p in ('/', '/index.html', '/setup'):
            if self.serve_static('index.html'):
                return
        if p in ('/command-center', '/command-center/', '/command-center.html'):
            if self.serve_static('command-center.html'):
                return
        if self.serve_static(p.lstrip('/')):
            return
        self.send_error(404)

    def do_POST(self):
        p = urlparse(self.path).path
        data = self.body()

        if p == '/api/plan':
            return self.sendj(APP.plan(data))
        if p == '/api/apply-org':
            return self.sendj(APP.apply_org())

        if p == '/api/scan/start':
            return self.sendj(APP.start_rescan_job())
        if p == '/api/install-tool/start':
            return self.sendj(APP.start_install_tool_job(data.get('package')))
        if p == '/api/pull-model/start':
            return self.sendj(APP.start_pull_model_job(data.get('model')))

        # Synchronous variants kept for compatibility / scripting.
        if p == '/api/install-tool':
            pkg = data.get('package')
            res = APP.record('install tool ' + str(pkg), actions.install_brew(pkg))
            APP.rescan()
            return self.sendj(res)
        if p == '/api/pull-model':
            model = data.get('model')
            res = APP.record('pull model ' + str(model), actions.pull_model(model))
            APP.rescan()
            return self.sendj(res)

        if p == '/api/remove-model':
            model = data.get('model')
            confirm = data.get('confirm')
            if confirm != model:
                return self.sendj({'ok': False, 'stderr': 'Confirmation did not exactly match model name.'}, 400)
            res = APP.record('remove model ' + model, actions.remove_model(model))
            APP.rescan()
            return self.sendj(res)

        if p == '/api/github-auth':
            return self.sendj(APP.record('launch GitHub auth', actions.github_auth()))
        if p == '/api/open-url':
            return self.sendj(actions.open_url(data.get('url', '')))
        if p == '/api/generate-integration':
            model_source = APP.state.setup.get('model_source', 'local')
            frontier_models = APP.state.setup.get('frontier_models', {})
            files = generate(APP.home, APP.org, APP.rec, model_source, frontier_models)
            APP.state.patch(integration_files=files)
            return self.sendj({'ok': True, 'files': files, 'status': integration_status()})
        if p == '/api/backup-hermes':
            return self.sendj(actions.backup_hermes(APP.home))
        if p == '/api/model-source':
            APP.state.patch(model_source=data.get('source', 'local'), frontier_models=data.get('frontier_models', {}))
            return self.sendj({'ok': True})

        if p == '/api/project':
            name = data.get('name', 'New Project')
            slug = data.get('slug', 'new-project')
            ptype = data.get('project_type', (APP.org.get('project_types') or ['ios'])[0])
            description = data.get('description', '')
            pid = APP.state.exec("INSERT OR IGNORE INTO projects(slug,name,project_type,description) VALUES(?,?,?,?)", (slug, name, ptype, description))
            for agent_id in data.get('agent_ids') or []:
                APP.state.exec("INSERT OR IGNORE INTO project_agents(project_id,agent_id) VALUES(?,?)", (pid, agent_id))
            APP._dispatch_to_hermes(pid, 'project', slug, {
                'name': name, 'description': description, 'project_type': ptype,
                'agents': data.get('agent_ids') or [],
                'prompt': f"New project '{name}' ({ptype}). {description or 'No description yet.'}",
            })
            return self.sendj({'ok': True, 'id': pid})
        if p == '/api/project-update':
            return self.sendj(APP.update_project(data))
        if p == '/api/project-archive':
            return self.sendj(APP.archive_project(data))
        if p == '/api/project-delete':
            return self.sendj(APP.delete_project(data))
        if p == '/api/project-agent':
            return self.sendj(APP.assign_agent(data))
        if p == '/api/project-file':
            return self.sendj(APP.add_project_file(data))
        if p == '/api/project-file-delete':
            return self.sendj(APP.delete_project_file(data))

        if p == '/api/task':
            return self.sendj(APP.create_task(data))
        if p == '/api/task-update':
            return self.sendj(APP.update_task(data))

        if p == '/api/ticket':
            project_id = int(data.get('project_id') or APP.state.ensure_default_project())
            prefix = data.get('prefix', 'INC')
            key = APP.state.next_key('tickets', prefix)
            title = data.get('title', 'Incident')
            problem = data.get('problem', '')
            priority = data.get('priority', 'P3')
            i = APP.state.exec(
                "INSERT INTO tickets(project_id,key,source,category,priority,title,problem) VALUES(?,?,?,?,?,?,?)",
                (project_id, key, data.get('source', 'internal'), data.get('category', 'incident'), priority, title, problem),
            )
            APP._dispatch_to_hermes(project_id, 'ticket', key, {
                'title': title, 'priority': priority, 'problem': problem,
                'prompt': f"New {priority} ticket '{title}': {problem or 'no details provided.'}",
            })
            return self.sendj({'ok': True, 'id': i, 'key': key})

        if p == '/api/approval':
            project_id = int(data.get('project_id') or APP.state.ensure_default_project())
            key = APP.state.next_key('approvals', 'CR')
            title = data.get('title', 'Change Request')
            description = data.get('description', '')
            i = APP.state.exec(
                "INSERT INTO approvals(project_id,key,type,title,description) VALUES(?,?,?,?,?)",
                (project_id, key, data.get('type', 'change'), title, description),
            )
            APP._dispatch_to_hermes(project_id, 'approval', key, {
                'title': title, 'description': description, 'status': 'pending',
                'prompt': f"New approval requested: '{title}'. {description or ''} Awaiting a decision in the Command Center.",
            })
            return self.sendj({'ok': True, 'id': i, 'key': key})

        if p == '/api/approval-decision':
            status = data.get('status')
            key = data.get('key')
            comment = data.get('comment', '')
            if status not in ['approved', 'rejected', 'changes_requested']:
                return self.sendj({'ok': False}, 400)
            APP.state.exec("UPDATE approvals SET status=?,comment=?,decided_at=CURRENT_TIMESTAMP WHERE key=?", (status, comment, key))
            row = APP.state.rows('SELECT * FROM approvals WHERE key=?', (key,))
            if row:
                a = row[0]
                APP._dispatch_to_hermes(a['project_id'], 'approval', key, {
                    'title': a['title'], 'status': status, 'comment': comment,
                    'prompt': f"Approval '{a['title']}' was {status}.{(' Comment: ' + comment) if comment else ''}",
                })
            return self.sendj({'ok': True})

        self.send_error(404)

    def log_message(self, *args):
        pass


def main():
    global APP
    ap = argparse.ArgumentParser()
    ap.add_argument('--package-root', default=str(Path(__file__).resolve().parents[1]))
    ap.add_argument('--home', default=str(Path.home() / 'Dispatch'))
    ap.add_argument('--port', type=int, default=8787)
    ap.add_argument('--open-browser', action='store_true')
    a = ap.parse_args()

    APP = App(a.package_root, a.home)
    APP.rescan()
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), H)
    url = f'http://127.0.0.1:{a.port}'
    print('Dispatch:', url)
    print('State:', APP.home)
    if a.open_browser:
        threading.Timer(.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
