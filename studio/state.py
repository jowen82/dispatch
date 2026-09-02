from __future__ import annotations
import json, sqlite3, threading
from pathlib import Path

class State:
    def __init__(self, home:Path):
        self.home=home; self.home.mkdir(parents=True,exist_ok=True)
        self.state_file=home/"setup-state.json"; self.db=home/"studio.db"; self.lock=threading.Lock()
        self.setup=self._load(); self._init_db()
    def _load(self):
        if self.state_file.exists():
            try:return json.loads(self.state_file.read_text())
            except:return {}
        return {}
    def save(self): self.state_file.write_text(json.dumps(self.setup,indent=2))
    def patch(self,**kw): self.setup.update(kw); self.save(); return self.setup
    def _init_db(self):
        c=sqlite3.connect(self.db)
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY,slug TEXT UNIQUE,name TEXT,project_type TEXT,description TEXT DEFAULT '',status TEXT DEFAULT 'planning',progress REAL DEFAULT 0,health REAL DEFAULT 100,created_at TEXT DEFAULT CURRENT_TIMESTAMP,archived_at TEXT);
        CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,project_id INTEGER,key TEXT UNIQUE,title TEXT,status TEXT DEFAULT 'backlog',priority TEXT DEFAULT 'P3',agent TEXT,branch TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY,project_id INTEGER,key TEXT UNIQUE,source TEXT,category TEXT,priority TEXT,title TEXT,problem TEXT,status TEXT DEFAULT 'new',assigned_agent TEXT,root_cause TEXT,resolution TEXT,verification TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,closed_at TEXT);
        CREATE TABLE IF NOT EXISTS ticket_notes(id INTEGER PRIMARY KEY,ticket_id INTEGER,author TEXT,body TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS approvals(id INTEGER PRIMARY KEY,project_id INTEGER,key TEXT UNIQUE,type TEXT,title TEXT,description TEXT,status TEXT DEFAULT 'pending',comment TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,decided_at TEXT);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,project_id INTEGER,type TEXT,actor TEXT,summary TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,name TEXT,department TEXT,level TEXT,model_capability TEXT,status TEXT DEFAULT 'idle',activity TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS project_agents(project_id INTEGER,agent_id TEXT,assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(project_id,agent_id));
        CREATE TABLE IF NOT EXISTS project_files(id INTEGER PRIMARY KEY,project_id INTEGER,key TEXT UNIQUE,filename TEXT,content_type TEXT,size_bytes INTEGER,note TEXT,agent TEXT,stored_path TEXT,hermes_status TEXT DEFAULT 'queued',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        ''')
        c.commit()
        # Lightweight migration for databases created before description/archived_at existed.
        existing_cols={row[1] for row in c.execute("PRAGMA table_info(projects)").fetchall()}
        for col,ddl in (("description","ALTER TABLE projects ADD COLUMN description TEXT DEFAULT ''"),("archived_at","ALTER TABLE projects ADD COLUMN archived_at TEXT")):
            if col not in existing_cols:
                try:c.execute(ddl);c.commit()
                except sqlite3.OperationalError:pass
        c.close()
    def rows(self,sql,args=()):
        c=sqlite3.connect(self.db);c.row_factory=sqlite3.Row;r=[dict(x) for x in c.execute(sql,args).fetchall()];c.close();return r
    def exec(self,sql,args=()):
        c=sqlite3.connect(self.db);cur=c.execute(sql,args);c.commit();i=cur.lastrowid;c.close();return i
    def next_key(self,table,prefix,width=6):
        """Return the next sequential PREFIX-000123 style key for a table."""
        existing=self.rows(f"SELECT key FROM {table} WHERE key LIKE ? ORDER BY id DESC LIMIT 1",(prefix+'-%',))
        n=1
        if existing:
            try:n=int(existing[0]['key'].split('-')[-1])+1
            except Exception:n=1
        return f"{prefix}-{n:0{width}d}"
    def ensure_default_project(self):
        """Guarantee at least one project exists so the kanban board always has a home."""
        row=self.rows("SELECT id FROM projects ORDER BY id LIMIT 1")
        if row:return row[0]['id']
        return self.exec("INSERT INTO projects(slug,name,project_type,status) VALUES(?,?,?,?)",("general","General","fullstack","active"))
