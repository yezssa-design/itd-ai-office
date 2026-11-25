// Builds the office config from the wizard answers and writes the office folder.
// Never overwrites a file that already exists.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const D = require('./defaults');
const T = require('./templates');

const RESERVED = new Set(['claude', 'explore', 'general-purpose', 'plan', 'statusline-setup', 'web-fetch', 'hana', 'pa']);

function slug(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'staff';
}

// answers: { company, pa, staff: [{ name, role, job }], invois }
function buildConfig(answers) {
  const used = new Set([slug(answers.pa || D.PA.name)]);
  const staff = answers.staff.map((a, i) => {
    let id = slug(a.name);
    if (RESERVED.has(id)) id += '-staff';
    let n = 2; const base = id;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    const def = [...D.STAFF, ...D.IT_STAFF].find((d) => d.name === a.name && d.role === a.role);
    return {
      id, name: a.name, role: a.role, job: a.job,
      colour: (D.STAFF[i] || D.STAFF[i % D.STAFF.length]).colour,
      rules: def ? def.rules : D.GENERIC_RULES,
      look: def ? def.look : { ...D.LOOK },
      ...(def && def.commands ? { commands: [...def.commands] } : {}),
    };
  });
  const addons = {};
  if (answers.invois) {
    addons[D.INVOIS.id] = {
      enabled: true, mcp: D.INVOIS.id, url: D.INVOIS.url,
      staff: staff.filter((s) => D.INVOIS.roles.some((r) => r.match.test(s.role))).map((s) => s.id),
      tipShown: false,
    };
  }
  return {
    company: answers.company,
    pa: { name: answers.pa || D.PA.name, colour: D.PA.colour, look: D.PA.look },
    staff, addons,
    port: D.PORT,
    key: crypto.randomBytes(16).toString('hex'),
    created: new Date().toISOString(),
  };
}

// Is this folder already an office?
const isOffice = (dir) => fs.existsSync(path.join(dir, 'office.json'));

function writeOffice(dir, cfg, opts = {}) {
  const nodePath = opts.nodePath || process.execPath;
  const written = [], skipped = [];
  const put = (rel, text) => {
    const f = path.join(dir, rel);
    if (fs.existsSync(f)) { skipped.push(rel); return; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    written.push(rel);
  };
  const settings = T.settingsJson(nodePath, dir);

  put('office.json', T.officeJson(cfg));
  put('CLAUDE.md', T.paClaude(cfg));
  put('OFFICE.md', T.officeMd(cfg));
  put('.gitignore', T.gitignore());
  put('.claude/settings.json', settings);
  put('.office/hook.js', fs.readFileSync(path.join(__dirname, '..', 'office-files', 'hook.js'), 'utf8'));
  put('.office/guard.js', fs.readFileSync(path.join(__dirname, '..', 'office-files', 'guard.js'), 'utf8'));
  put('.office/staff-chats.md', T.staffChatsMd(cfg));
  for (const s of cfg.staff) {
    put(`staff/${s.id}/CLAUDE.md`, T.staffClaude(cfg, s));
    put(`staff/${s.id}/.claude/settings.json`, settings);
    put(`.claude/agents/${s.id}.md`, T.agentMd(cfg, s));
  }
  for (const sk of T.skills()) put(`.claude/skills/${sk.name}/SKILL.md`, sk.text);
  writeLauncher(dir, nodePath);
  for (const d of ['inbox', 'approvals', 'projects', 'tasks']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  return { written, skipped };
}

// Office settings hold absolute paths (Node, the hook script, the office folder for
// the pre-allowed file rules). If Node or the folder moved, rewrite them. Runs on each start.
// Everything the user added (other settings, their own hooks and rules) is kept.
// Folders outside the office the boss linked: office-wide (office.json "linked") and per project
// (a "linked:" line in projects/<id>/CLAUDE.md). Only folders that still exist count.
function linkedFolders(dir) {
  const md = require('./md');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8')); } catch { /* no office */ }
  const out = (cfg.linked || []).map((l) => ({ path: l.path, label: l.label || '', project: '' }));
  const root = path.join(dir, 'projects');
  if (fs.existsSync(root)) {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      try {
        const f = md.parse(fs.readFileSync(path.join(root, e.name, 'CLAUDE.md'), 'utf8')).fields;
        if (f.linked) out.push({ path: f.linked, label: '', project: e.name });
      } catch { /* no CLAUDE.md */ }
    }
  }
  return out.filter((l) => l.path && path.isAbsolute(l.path) && fs.existsSync(l.path) && fs.statSync(l.path).isDirectory());
}

function repairSettings(dir, nodePath = process.execPath) {
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8'));
  const linked = [...new Set(linkedFolders(dir).map((l) => path.resolve(l.path)))];
  const next = JSON.parse(T.settingsJson(nodePath, dir, undefined, linked));
  const before = new Set(cfg.rulesApplied || []); // our rules from last time (e.g. a folder since unlinked)
  const files = ['.claude/settings.json', ...cfg.staff.map((s) => `staff/${s.id}/.claude/settings.json`)];
  const HOOK = /^"[^"]*" "(.*)[\\/]\.office[\\/](?:hook|guard)\.js"$/; // "<node>" "<office>/.office/hook.js"
  const fixed = [];
  for (const rel of files) {
    const f = path.join(dir, rel);
    let cur = null;
    try { cur = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* missing or broken */ }
    const curHooks = (cur && cur.hooks) || {};
    // find the office folder our old hooks pointed at, so its old file rules can be dropped
    const oldDirs = new Set();
    const ours = (e) => (e.hooks || []).some((h) => { const m = HOOK.exec(h.command || ''); if (m) oldDirs.add(m[1]); return !!m; });
    const hooks = { ...curHooks };
    for (const ev of Object.keys(curHooks)) hooks[ev] = (curHooks[ev] || []).filter((e) => !ours(e));
    for (const ev of Object.keys(next.hooks)) hooks[ev] = [...(hooks[ev] || []), ...next.hooks[ev]];
    const oldRules = new Set([...[...oldDirs].flatMap((d) => T.officeRules(d)), ...before]);
    const curAllow = ((cur && cur.permissions && cur.permissions.allow) || []).filter((r) => !oldRules.has(r));
    const allow = [...curAllow, ...next.permissions.allow.filter((r) => !curAllow.includes(r))];
    const merged = { ...(cur || {}), permissions: { ...((cur && cur.permissions) || {}), allow }, hooks };
    if (cur && JSON.stringify(merged) === JSON.stringify(cur)) continue; // already right
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(merged, null, 2) + '\n');
    fixed.push(rel);
  }
  if (JSON.stringify(cfg.rulesApplied || []) !== JSON.stringify(next.permissions.allow)) {
    cfg.rulesApplied = next.permissions.allow;
    fs.writeFileSync(path.join(dir, 'office.json'), JSON.stringify(cfg, null, 2) + '\n');
  }
  return fixed;
}

// Copy our own scripts into .office/ when missing or out of date (never a file the user changed:
// each one starts with our marker line).
function refreshScripts(dir) {
  const done = [];
  for (const [name, mark] of [['hook.js', 'AI Office hook'], ['guard.js', 'AI Office command guard']]) {
    const want = fs.readFileSync(path.join(__dirname, '..', 'office-files', name), 'utf8');
    const f = path.join(dir, '.office', name);
    let cur = null; try { cur = fs.readFileSync(f, 'utf8'); } catch { /* missing */ }
    if (cur === want || (cur !== null && !cur.includes(mark))) continue;
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, want); done.push(`.office/${name}`);
  }
  return done;
}

// Write or refresh the "Start AI Office" launcher (only our own file, never a user's).
// Running inside WSL? Then the boss is on Windows: the name of this Linux (for wsl.exe -d), else null.
function wslDistro() {
  if (process.platform !== 'linux' || !process.env.WSL_DISTRO_NAME) return null;
  try { return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')) ? process.env.WSL_DISTRO_NAME : null; } catch { return null; }
}
function writeLauncher(dir, nodePath = process.execPath) {
  const l = T.launcher(nodePath);
  const f = path.join(dir, l.name);
  if (fs.existsSync(f)) {
    const cur = fs.readFileSync(f, 'utf8');
    if (cur === l.text || !cur.includes(T.LAUNCHER_MARK)) return null;
  }
  fs.writeFileSync(f, l.text, { mode: l.mode });
  try { fs.chmodSync(f, l.mode); } catch { /* Windows */ }
  return l.name;
}

module.exports = { slug, buildConfig, writeOffice, isOffice, repairSettings, writeLauncher, wslDistro, linkedFolders, refreshScripts };
