// Dashboard chats. Each message runs the user's own Claude Code once:
//   claude -p "<message>" --resume <session> --output-format stream-json --verbose
// in the office folder (the PA) or in staff/<id>/ (a direct staff chat).
// Replies and staff activity are saved to .office/chats/<id>.jsonl and pushed to the page.
// After a direct staff chat, one summary line goes to .office/staff-chats.md for the PA.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { officeRules, rulePath, addonAllowed, addonActions } = require('./templates');
const { linkedFolders } = require('./generate');

// Only these tools exist in dashboard chats, so Claude never waits on a permission
// prompt nobody can see (see docs/milestone-1-findings.md). Reading and writing are
// allowed only inside the office folder and the folders the boss linked: anything else
// on the computer is refused (no prompt in a dashboard chat, so it just fails).
// No Agent tool: staff work runs as its own task (lib/tasks.js), so a chat never waits for it.
const TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
const CTX_LIMIT = 100000; // tokens per request; above this a chat starts a fresh conversation with a recap

function access(dir, who = 'pa', opts = {}) { // opts.task: inside a running task (no new tasks from there)
  const linked = linkedFolders(dir);
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8')); } catch { /* none */ }
  const { PRESETS, cmdsOf } = require('../office-files/guard');
  const everyone = (cfg.staff || []).filter((s) => cmdsOf(s).length + (s.customCommands || []).length > 0);
  const runners = everyone.filter((s) => who === 'pa' || s.id === who);
  const what = (s) => [...cmdsOf(s).map((k) => (PRESETS[k] || {}).label || k), ...(s.customCommands || [])].join(', ');
  // Office documents: how to make real files (the tools install themselves on the first start)
  const me = (cfg.staff || []).find((s) => s.id === who);
  const docsNote = me && cmdsOf(me).includes('docs')
    ? `Office documents: you can make real PowerPoint (.pptx), Excel (.xlsx), Word (.docx), PDF and image (.png) files. Read ${path.join(dir, '.office', 'doc-tools', 'README.md')} first: it shows how. Write a small make-<thing>.cjs script in the project folder, run it with exactly node "<script>.cjs" (nothing else is allowed: no node -e, no ; | > or 2>/dev/null; for any check, put it in the script), check the file (Read shows images), and keep the script for later changes. Prefer these real formats over plain text or HTML when the boss asks for a deck, sheet, document, poster or picture.`
    : who === 'pa' && everyone.some((s) => cmdsOf(s).includes('docs'))
      ? 'Office documents: staff can make real PowerPoint, Excel, Word, PDF and PNG image files. When the boss asks for a deck, sheet, document, poster or picture, ask for that real format.'
      : '';
  const cmdNote = runners.length
    ? `Commands: only ${runners.map((s) => `${s.name} (${what(s)})`).join('; ')} may run commands; hand command work to them. A guard checks every command: it must be on their list, run in the office or a linked folder (start with cd "<folder>" &&), with no ; | $ > < tricks. Never run: git push, reset --hard, migrate:fresh, rm. The boss runs those himself.`
    : everyone.length
      ? `Commands: you cannot run commands. Only ${everyone.map((s) => s.name).join(', ')} can (ask the boss to give the task to them, or to tick commands for you on the Staff page).`
      : 'Commands: nobody in this office can run commands (git, artisan, npm, composer, delete). The boss can turn them on per staff on the Staff page of the dashboard; there is no other way, so do not suggest hiring or adding a staff for it.';
  const paths = [...new Set(linked.map((l) => path.resolve(l.path)))];
  const allowed = [...[dir, ...paths].flatMap((d) => officeRules(d)), ...addonAllowed(cfg, who)];
  const note = linked.length
    ? `Folders outside the office the boss linked (you may read and write only these, plus the office folder):\n${linked.map((l) => `- ${l.path}${l.project ? ` (project ${l.project}: that project's files live here)` : l.label ? ` (${l.label})` : ''}`).join('\n')}\nNever touch any other folder outside the office.`
    : 'You may read and write only inside the office folder. Other folders on this computer are off limits unless the boss links them in the dashboard (Settings > Linked folders).';
  const pa = (cfg.pa && cfg.pa.name) || 'the manager';
  const taskNote = who === 'pa'
    ? `Handing out work (dashboard): do not do the work yourself and do not use the Agent tool. For each piece of work, create one task file ${path.join(dir, 'tasks', '<YYYYMMDD-HHMMSS>-<staff id>.md')} containing:\n---\nstaff: <staff id>\nproject: <project folder name, or empty>\nstatus: new\n---\n<first line: a short title of 3 to 6 words, like "Website for Kedai Ali">\n<then the details: what, for whom, which folder, what done looks like>\nThe office starts that staff right away and sends you their report when they finish ("[Office update]"). So answer the boss straight away in plain words (for example: Shah is on it), never mention task files or folders to the boss, and do not wait or check on the staff yourself. Several tasks for different staff run at the same time.`
    : opts.task
      ? `You are working on a task. You cannot ask colleagues from here: if you need someone, say so in your report and ${pa} will arrange it.`
      : `You are ${((cfg.staff || []).find((s) => s.id === who) || {}).name || who}, talking with the boss directly. Do your own work yourself. To ask a colleague something or hand them a small piece of work, create one task file ${path.join(dir, 'tasks', `<YYYYMMDD-HHMMSS>-<their staff id>.md`)} containing:\n---\nstaff: <their staff id>\nfrom: ${who}\nproject: <project folder name, or empty>\nstatus: new\n---\n<first line: a short title>\n<then the question or work>\nThe office runs it and sends you their answer ("[Office update]"); ${pa} sees it too. Tell the boss you asked them, without mentioning files. Bigger new work goes through ${pa}. Colleagues: ${(cfg.staff || []).filter((s) => s.id !== who).map((s) => `${s.id} (${s.name}, ${s.role})`).join(', ')}.`;
  // ask-first add-on actions this person can use, and whether the boss set them to Always allow
  const { ASK_FIRST } = require('../office-files/guard');
  const mine = addonActions(cfg, who).filter((t) => ASK_FIRST[t]).map((t) => [t, ASK_FIRST[t]]);
  const inv = (cfg.addons || {})['invois-online'];
  const invNote = who === 'pa' && inv && inv.enabled
    ? `invois.online: ${(inv.staff || []).map((id) => ((cfg.staff || []).find((x) => x.id === id) || {}).name || id).join(' and ')} can look up and create quotations and invoices without asking; you can look things up. Settings > Add-ons only has the actions that leave the office (email a quotation or invoice, record a payment). If invois.online says it needs a login, use its authenticate tool and give the boss the link. Never invent other settings or steps.`
    : '';
  const actNote = mine.length ? `Actions that leave the office: ${mine.map(([t, r]) => `${t.split('__').pop()} (${r.label}): ${allowed.includes(t) ? 'the boss set it to Always allow, just do it' : 'ask first with an approval file that has tool: and input: (OFFICE.md), then stop; the office starts you on it once approved'}`).join('; ')}.` : '';
  // Files the office itself keeps: settings, hooks, the guard and the boss's OKs. Dashboard runs may read
  // them, never change them (so nobody can approve their own request or loosen their own rules).
  const r = rulePath(path.resolve(dir)).replace(/\/+$/, '');
  const denied = [`${r}/office.json`, `${r}/.office/**`, `${r}/.claude/**`, `${r}/staff/*/.claude/**`].map((x) => `Edit(${x})`);
  return { allowed, denied, paths, note: [note, cmdNote, docsNote, taskNote, actNote, invNote].filter(Boolean).join('\n'), shell: who !== 'pa' && runners.length > 0 };
}

let claudeCmd = null; // resolved once: { cmd, pre: [] }
function resolveClaude() {
  if (claudeCmd) return claudeCmd;
  claudeCmd = { cmd: 'claude', pre: [] };
  if (process.platform === 'win32') {
    // claude.exe runs directly. An npm install gives claude.cmd: run its cli.js with node
    // instead of going through cmd.exe, so the message text is never parsed by a shell.
    const r = spawnSync('where', ['claude'], { encoding: 'utf8', windowsHide: true });
    const found = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const first = found.find((f) => /\.(exe|cmd)$/i.test(f)); // the one PATH would pick
    if (first && /\.exe$/i.test(first)) claudeCmd = { cmd: first, pre: [] };
    else if (first) {
      const cli = path.join(path.dirname(first), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(cli)) claudeCmd = { cmd: process.execPath, pre: [cli] };
    }
  }
  return claudeCmd;
}

// If Claude Code itself started the dashboard (INSTALL.md does that), its session variables are
// inherited, and the chat's claude would act as a child of that other session. Drop those;
// keep the user's settings (config folder, login, model, Windows Git Bash path).
const SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|OLDPWD|CLAUDE_CODE_(CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|CHILD_NOTES_DIR|MESSAGING_SOCKET|MESSAGING_TOKEN|ENTRYPOINT|EXECPATH|SSE_PORT))$/;
// Is the invois.online MCP set up in Claude Code itself (user scope, or the office's .mcp.json),
// not only as a claude.ai connector? Read-only look at the config; nothing is changed.
function addonIsLocal(dir, id = 'invois-online') {
  const has = (f) => { try { return !!(JSON.parse(fs.readFileSync(f, 'utf8')).mcpServers || {})[id]; } catch { return false; } };
  return has(path.join(require('os').homedir(), '.claude.json')) || has(path.join(dir, '.mcp.json'));
}
// MCP flags and env for one run (see templates.mcpRun).
function mcpFor(dir, cfg, who) { return require('./templates').mcpRun(cfg, who, addonIsLocal(dir)); }

function chatEnv(cwd) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!SESSION_VARS.test(k)) env[k] = v;
  // PWD: Claude Code resolves relative paths from it. localLlm.envFor() points Claude Code at Ollama (or adds nothing).
  return { ...env, PWD: cwd, AI_OFFICE_CHAT: '1', ...require('./local-llm').envFor() };
}

// What Claude is doing, in plain words, from a tool call: "Reading OFFICE.md", "Handing to Shah".
function describe(tool, input = {}, staffName = (x) => x) {
  // office records have long dated names: say what they are instead
  const base = (f) => {
    const x = String(f || ''), dir = path.basename(path.dirname(x));
    if (/\.md$/.test(x) && { approvals: 1, inbox: 1, tasks: 1 }[dir]) return { approvals: 'an approval', inbox: 'an inbox item', tasks: 'a task' }[dir];
    return path.basename(x) || 'a file';
  };
  const where = String(input.file_path || input.path || '');
  if ((tool === 'Write' || tool === 'Edit') && /[\\/]tasks[\\/][^\\/]+\.md$/.test(where)) {
    const m = /^staff:\s*([\w-]+)/m.exec(String(input.content || ''));
    return m ? `Handing to ${staffName(m[1])}` : 'Handing out work';
  }
  switch (tool) {
    case 'Read': return `Reading ${base(where)}`;
    case 'Write': return `Writing ${base(where)}`;
    case 'Edit': return `Editing ${base(where)}`;
    case 'Glob': { const g = String(input.pattern || '').replace(/^(\*\*\/)+/, ''); return !g || /^[*./]+$/.test(g) ? 'Looking through files' : `Looking for ${g.slice(0, 40)}`; }
    case 'Grep': return input.pattern ? `Searching for "${String(input.pattern).slice(0, 30)}"` : 'Searching';
    case 'Bash': return `Running ${String(input.command || '').replace(/^cd\s+("[^"]*"|\S+)\s*&&\s*/, '').slice(0, 48)}`;
    default: return /^mcp__/.test(tool) ? `Using ${tool.split('__').slice(1).join(' ').replace(/_/g, ' ')}` : `Using ${tool}`;
  }
}

class Chats {
  constructor(dir, { onMessage, onState, loadCfg, onLive, onUsage }) {
    this.dir = dir;
    this.root = path.join(dir, '.office', 'chats');
    this.onMessage = onMessage; this.onState = onState; this.loadCfg = loadCfg;
    this.onLive = onLive || (() => {}); // { step, text }: what is happening now, the answer so far
    this.onUsage = onUsage || (() => {}); // every stream-json line, for plan limits and tokens
    this.runs = new Map(); // id -> child process
    this.queue = new Map(); // id -> [prompt]: waits for the current reply to finish
    fs.mkdirSync(this.root, { recursive: true });
  }

  sessionsFile() { return path.join(this.root, 'sessions.json'); }
  sessions() { try { return JSON.parse(fs.readFileSync(this.sessionsFile(), 'utf8')); } catch { return {}; } }
  setSession(id, sid) { const s = this.sessions(); if (sid) s[id] = sid; else delete s[id]; fs.writeFileSync(this.sessionsFile(), JSON.stringify(s, null, 2)); if (!sid) this.setMeta(id, null); }
  // Per conversation: how big it got (tokens sent with the last request) and which MCP setup it was made with.
  metaFile() { return path.join(this.root, 'sessions-meta.json'); }
  meta() { try { return JSON.parse(fs.readFileSync(this.metaFile(), 'utf8')); } catch { return {}; } }
  setMeta(id, m) { const all = this.meta(); if (m) all[id] = m; else delete all[id]; try { fs.writeFileSync(this.metaFile(), JSON.stringify(all, null, 2)); } catch { /* no chats folder yet */ } }
  // A short recap of the recent chat, for the first message of a fresh conversation.
  recap(who, msg) {
    const name = 'You';
    const h = this.history(who, 40).messages.filter((m) => m.from === 'boss' || m.from === who);
    if (h.length && h[h.length - 1].from === 'boss' && h[h.length - 1].text === msg) h.pop();
    const lines = h.slice(-12).map((m) => `${m.from === 'boss' ? 'Boss' : name}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 400)}`);
    return lines.length ? `[Recap of the recent chat, for context. The work itself is in the office files (tasks/, projects/, inbox/).]\n${lines.join('\n')}\n\n[New message]\n${msg}` : msg;
  }

  log(id) { return path.join(this.root, `${id}.jsonl`); }
  add(id, m) {
    const msg = { at: new Date().toISOString(), ...m };
    fs.appendFileSync(this.log(id), JSON.stringify(msg) + '\n');
    this.onMessage(id, msg);
    return msg;
  }
  history(id, limit = 200) {
    let lines = [];
    try { lines = fs.readFileSync(this.log(id), 'utf8').trim().split('\n'); } catch { /* no chat yet */ }
    const out = [];
    for (const l of lines.slice(-limit)) { try { out.push(JSON.parse(l)); } catch { /* skip */ } }
    return { messages: out, running: this.runs.has(id) };
  }
  running() { return [...this.runs.keys()]; }

  // who: 'pa' or a staff id (already checked by the caller)
  send(who, text) {
    const msg = String(text || '').trim().slice(0, 8000);
    if (!msg) { const e = new Error('Empty message'); e.status = 400; throw e; }
    this.add(who, { from: 'boss', text: msg });
    if (this.runs.has(who)) { this.enqueue(who, msg); return { ok: true, queued: true }; }
    this.run(who, msg, true);
    return { ok: true };
  }

  // The office tells someone something (a task finished, an approval was decided). Not shown as
  // a message from the boss; the reply shows as usual.
  notify(who, prompt) {
    if (this.runs.has(who)) return this.enqueue(who, prompt);
    this.run(who, prompt, true);
  }
  enqueue(who, prompt) {
    if (!this.queue.has(who)) this.queue.set(who, []);
    this.queue.get(who).push(prompt);
  }
  // Everything that came in while busy goes in one run (one run per message would repeat the whole context).
  next(who) {
    const q = (this.queue.get(who) || []).splice(0);
    if (!q.length) return;
    const p = q.length === 1 ? q[0] : `Several messages came in while you were busy. Handle them together, in this order:\n\n${q.map((m, i) => `${i + 1}. ${m}`).join('\n\n')}`;
    this.run(who, p, true, true);
  }

  run(who, msg, mayRetry, cont) { // cont: still busy from the previous run, so no new busy signal
    const cfg = this.loadCfg();
    const cwd = who === 'pa' ? this.dir : path.join(this.dir, 'staff', who);
    const staffName = (id) => ((cfg.staff || []).find((s) => s.id === id) || {}).name || id;
    const acc = access(this.dir, who);
    const allowed = [...acc.allowed];
    let sid = this.sessions()[who];
    const mcp = mcpFor(this.dir, cfg, who);
    // Every request sends the whole conversation again, so a long one gets slow and costly. Start fresh (with a
    // recap) when it grew past CTX_LIMIT tokens, or was made with other MCP servers (their tool lists stay in it).
    const mcpKey = mcp.args.join(' ') + JSON.stringify(mcp.env), meta = this.meta()[who];
    if (sid && !cont && (!meta || meta.mcp !== mcpKey || meta.ctx > CTX_LIMIT)) {
      this.setSession(who, null); sid = null;
      this.add(who, { from: 'system', kind: 'new', text: 'Fresh conversation (the last one got long), with a short recap' });
      msg = this.recap(who, msg);
    }
    let ctxNow = 0;
    const args = ['-p', msg, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'default',
      '--tools', [...TOOLS, ...(acc.shell ? ['Bash'] : [])].join(','), '--allowedTools', allowed.join(','), '--disallowedTools', acc.denied.join(','), ...acc.paths.flatMap((d) => ['--add-dir', d]),
      '--append-system-prompt', acc.note, ...require('./templates').runFlags(cfg, who), ...mcp.args, ...(sid ? ['--resume', sid] : [])];
    const { cmd, pre } = resolveClaude();
    let child;
    try {
      child = spawn(cmd, [...pre, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...chatEnv(cwd), ...mcp.env } });
    } catch (e) {
      this.add(who, { from: 'system', kind: 'error', text: `Could not start Claude Code: ${e.message}` });
      if (cont) this.onState(who, false);
      return;
    }
    this.runs.set(who, child);
    if (!cont) this.onState(who, true);

    const tasks = new Map(); // task id -> { name, desc }
    let buf = '', err = '', said = '', lastErr = '';
    // live view: the current step and the answer as it is being written (sent at most every 100 ms)
    const live = { step: 'Starting', text: '' };
    let liveTimer = null;
    const pushLive = (now) => {
      if (now) { clearTimeout(liveTimer); liveTimer = null; this.onLive(who, { ...live }); return; }
      if (!liveTimer) liveTimer = setTimeout(() => { liveTimer = null; this.onLive(who, { ...live }); }, 100);
    };
    pushLive(true);
    const handle = (j) => {
      this.onUsage(j, who, 'chat');
      if (j.type === 'system' && j.subtype === 'init' && j.session_id) { this.setSession(who, j.session_id); live.step = 'Thinking'; pushLive(); }
      else if (j.type === 'stream_event' && !j.parent_tool_use_id) {
        const e = j.event || {};
        if (e.type === 'message_start') { live.text = ''; }
        else if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'thinking') { live.step = 'Thinking'; pushLive(); }
        else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') { live.text += e.delta.text; live.step = 'Writing the answer'; pushLive(); }
      } else if (j.type === 'system' && j.subtype === 'thinking_tokens') { if (!live.text) { live.step = 'Thinking'; pushLive(); } }
      else if (j.type === 'assistant' && !j.parent_tool_use_id) {
        const u = j.message.usage; if (u) ctxNow = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        for (const c of j.message.content || []) if (c.type === 'tool_use') { live.step = describe(c.name, c.input, staffName); pushLive(true); }
        const t = (j.message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
        if (t) { said += `${t}\n`; live.text = ''; this.add(who, { from: who, text: t }); pushLive(true); }
      } else if (j.type === 'system' && j.subtype === 'task_started') {
        const name = staffName(j.subagent_type); tasks.set(j.task_id, { name, desc: j.description || '' });
        this.add(who, { from: 'system', kind: 'activity', staff: j.subagent_type, text: `${name} started: ${j.description || 'a task'}` });
      } else if (j.type === 'system' && j.subtype === 'task_notification') {
        const t = tasks.get(j.task_id) || { name: 'A staff', desc: '' };
        const ok = j.status === 'completed';
        this.add(who, { from: 'system', kind: 'activity', staff: '', done: ok, text: `${t.name} ${ok ? 'finished' : 'stopped'}: ${t.desc || 'a task'}` });
      } else if (j.type === 'result' && j.is_error) {
        lastErr = String(j.result || j.subtype || 'Claude stopped with an error');
      }
    };
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line.startsWith('{')) { try { handle(JSON.parse(line)); } catch { /* not ours */ } }
      }
    });
    child.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    child.on('error', (e) => { lastErr = e.code === 'ENOENT' ? 'Claude Code was not found. Is it installed on this computer?' : e.message; });
    child.on('close', (code) => {
      this.runs.delete(who);
      clearTimeout(liveTimer); this.onLive(who, { step: '', text: '' });
      const errText = `${lastErr}\n${err}`;
      if (sid && mayRetry && /no conversation found|session.*not found/i.test(errText)) { // old session gone: start fresh once
        this.setSession(who, null);
        return this.run(who, msg, false, true);
      }
      if (this.sessions()[who]) this.setMeta(who, { ctx: ctxNow, mcp: mcpKey, at: new Date().toISOString() });
      if (child.stopped) this.add(who, { from: 'system', kind: 'activity', text: 'Stopped.' });
      else if (lastErr || (code !== 0 && !said)) this.add(who, { from: 'system', kind: 'error', text: plainError(lastErr || err) });
      if (who !== 'pa' && said && !msg.startsWith('[Office update')) this.summarise(who, staffName(who), msg, said);
      if ((this.queue.get(who) || []).length && !child.stopped) return this.next(who); // still busy: the next message goes now
      this.onState(who, false);
    });
  }

  // Forget the Claude session: the next message starts a fresh conversation.
  // The old messages stay in the history file; a divider marks the new start.
  reset(who) {
    if (this.runs.has(who)) { const e = new Error('Wait for the reply (or press Stop) before starting a new conversation.'); e.status = 409; throw e; }
    this.setSession(who, null);
    this.add(who, { from: 'system', kind: 'new', text: 'New conversation' });
    return { ok: true };
  }

  stop(who) {
    this.queue.delete(who); // Stop also drops what was waiting
    const c = this.runs.get(who);
    if (!c) return { ok: true };
    c.stopped = true;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f'], { windowsHide: true });
    else c.kill('SIGTERM');
    return { ok: true };
  }

  stopAll() { for (const id of this.runs.keys()) this.stop(id); }

  // One line per direct staff chat, so the PA never gives conflicting orders.
  summarise(who, name, asked, said) {
    const one = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
    const d = new Date();
    const when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const line = `- ${when}, ${name}: boss said "${one(asked, 200)}". ${name} replied "${one(said, 240)}"\n`;
    fs.appendFileSync(path.join(this.dir, '.office', 'staff-chats.md'), line);
  }
}

function plainError(s) {
  const t = String(s || '').trim();
  if (/usage limit|rate limit|limit reached/i.test(t)) return `Your Claude usage limit is reached for now. ${t.split('\n')[0]}`;
  if (/not logged in|login|authenticate|invalid api key|oauth/i.test(t)) return 'Claude Code is not logged in. Run "claude" once in a terminal and log in, then try again.';
  return `Claude stopped with an error: ${t.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 400) || 'unknown error'}`;
}

module.exports = { Chats, TOOLS, access, chatEnv, mcpFor, resolveClaude, describe };
