// The setup wizard: a few questions in the terminal, Enter keeps the [default].

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const D = require('./defaults');
const G = require('./generate');
const claude = require('./claude');

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n) => (s) => (color ? `\x1b[${n}m${s}\x1b[0m` : s);
const purple = c('1;35'), green = c('32'), cyan = c('36'), dim = c('2'), red = c('31'), bold = c('1');
const ok = (s) => console.log(`${green('✓')} ${s}`);

// Line reader that also works when answers are piped in (tests, scripts).
function makeAsk(yes) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines = []; let wait = null, closed = false;
  rl.on('line', (l) => { if (wait) { const w = wait; wait = null; w(l); } else lines.push(l); });
  rl.on('close', () => { closed = true; if (wait) { const w = wait; wait = null; w(''); } });
  const next = () => (lines.length ? Promise.resolve(lines.shift()) : closed ? Promise.resolve('') : new Promise((r) => { wait = r; }));
  const ask = async (q, def, check) => {
    for (;;) {
      process.stdout.write(`${cyan("?")} ${q} ${def === "" ? "" : dim(`[${def}]`) + " "}`);
      if (yes) { console.log(''); return String(def); }
      const a = (await next()).trim();
      if (!process.stdin.isTTY) console.log(a);
      const v = a || String(def);
      const err = check ? check(v) : null;
      if (!err) return v;
      console.log(`  ${red(err)}`);
    }
  };
  return { ask, close: () => rl.close() };
}

async function wizard(opts = {}) {
  console.log(`\n${purple('AI OFFICE')}\nSet up your own AI office staff. Press Enter to keep the ${dim('[default]')}.\n`);

  if (!opts.skipCheck) {
    const cc = claude.check();
    if (!cc.installed) {
      console.log(`${red('✗')} Claude Code is not installed.\n
  Install it, log in once, then run this again:
    npm install -g @anthropic-ai/claude-code
    claude
  Guide: https://docs.claude.com/en/docs/claude-code/setup\n`);
      return 1;
    }
    const LL = require('./local-llm');
    if (LL.enabled()) {
      const pg = await LL.ping();
      if (!pg.ok) { console.log(`${red('✗')} ${pg.error || 'Ollama is not ready.'}\n  Start Ollama on the DGX Spark, or set OLLAMA_URL.\n`); return 1; }
      if (pg.missing.length) { console.log(`${red('✗')} Ollama is missing models: ${pg.missing.join(', ')}\n${pg.missing.map((m) => `  ollama pull ${m}`).join('\n')}\n  (or choose others with AI_OFFICE_MODEL_OPUS / _SONNET / _HAIKU)\n`); return 1; }
      ok(`Local models ready on ${pg.url} ${dim('(no Claude login needed)')}`);
    } else if (!cc.loggedIn) {
      console.log(`${red('✗')} Claude Code is installed but not logged in.\n
  Run ${bold('claude')} once and log in with your Claude account, then run this again.\n`);
      return 1;
    }
    if (!LL.enabled()) ok(`Claude Code found, logged in ${dim(`(${cc.version})`)}`);
  }

  let a;
  if (opts.answers) {
    a = fromFile(opts.answers);
    if (a.error) { console.log(`${red('✗')} ${a.error}`); return 1; }
  } else {
    a = await askAll(opts);
  }
  return create(a, opts);
}

// Answers from a JSON file (used when Claude runs the setup for the user).
// Anything missing gets the default. Example:
// { "company": "Kedai Ali", "folder": "./kedai-ali", "pa": "Hana", "invois": false,
//   "staff": [{ "name": "Aina", "role": "Customer Service", "job": "..." }, ...] }
function fromFile(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { error: `Cannot read answers file ${file}: ${e.message}` }; }
  const company = (j.company || D.COMPANY).trim();
  const folder = j.folder || `./${G.slug(company) === G.slug(D.COMPANY) ? D.FOLDER : G.slug(company)}`;
  if (G.isOffice(path.resolve(folder))) return { error: `${folder} already has an office. Pick another folder.` };
  let staff = j.staff;
  if (staff == null) staff = D.STAFF.slice(0, j.staffCount || D.STAFF_COUNT);
  if (!Array.isArray(staff) || staff.length < 1 || staff.length > 8) return { error: 'staff must be a list of 1 to 8 people.' };
  staff = staff.map((x, i) => {
    const d = [...D.STAFF, ...D.IT_STAFF].find((s) => s.name === (x.name || '').trim()) || {};
    return { name: (x.name || D.STAFF[i].name).trim(), role: (x.role || d.role || '').trim(), job: (x.job || d.job || '').trim() };
  });
  const bad = staff.find((x) => !x.role || !x.job);
  if (bad) return { error: `Staff "${bad.name}" needs a role and a job description.` };
  return { company, folder, pa: (j.pa || D.PA.name).trim(), staff, invois: j.invois === true };
}

async function askAll(opts) {
  const { ask, close } = makeAsk(opts.yes);
  try {
    const company = await ask('Company name', D.COMPANY);
    const folderDef = opts.dir || `./${G.slug(company) === G.slug(D.COMPANY) ? D.FOLDER : G.slug(company)}`;
    const folder = await ask('Office folder', folderDef, (v) => (G.isOffice(path.resolve(v)) ? 'That folder already has an office. Pick another one.' : null));
    const pa = await ask("Your manager's name", D.PA.name);
    const count = Number(await ask('How many staff? (1-8)', D.STAFF_COUNT, (v) => (/^[1-8]$/.test(v) ? null : 'Type a number from 1 to 8.')));

    const staff = [];
    for (let i = 0; i < count; i++) {
      const d = D.STAFF[i];
      console.log(`\n${bold(`Staff ${i + 1} of ${count}`)}`);
      const nonEmpty = (v) => (v.trim() ? null : 'Please type something.');
      const name = await ask('Name', d.name, nonEmpty);
      const role = await ask('Role', name === d.name ? d.role : '', nonEmpty);
      const job = await ask(`What does ${name} do?`, role === d.role ? d.job : '', nonEmpty);
      staff.push({ name, role, job });
    }

    console.log(`\n${bold('Optional add-on')}`);
    const inv = await ask(`Do you send quotations or invoices? Connect the invois.online MCP so your sales and finance staff
    make real ones (free plan: 60 documents a month)`, 'y/N', (v) => (/^(y|yes|n|no|y\/n)$/i.test(v) ? null : 'Type y or n.'));
    const invois = /^y(es)?$/i.test(inv);
    return { company, folder, pa, staff, invois };
  } finally {
    close();
  }
}

async function create({ company, folder, pa, staff, invois }, opts) {
  const dir = path.resolve(folder);
  {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) console.log(dim(`\nThe folder is not empty. Existing files are kept, never overwritten.`));
    const cfg = G.buildConfig({ company, pa, staff, invois });
    const res = G.writeOffice(dir, cfg);
    console.log('');
    ok(`Office created in ${folder} ${dim(`(${pa} + ${staff.length} staff, ${res.written.length} files)`)}`);
    if (res.skipped.length) console.log(dim(`  Kept your existing: ${res.skipped.join(', ')}`));

    if (invois) {
      const r = opts.skipCheck ? { ok: false, err: 'skipped' } : claude.mcpAdd(dir, D.INVOIS.id, D.INVOIS.url);
      if (r.ok) ok(`invois.online MCP ${r.existed ? 'already in' : 'added to'} your Claude Code. To log in, run: ${bold('claude mcp login invois-online')}`);
      else console.log(`${red('!')} Could not add the invois.online MCP (${r.err || 'unknown error'}). Add it later:\n    claude mcp add --transport http --scope user ${D.INVOIS.id} ${D.INVOIS.url}`);
      console.log(dim(`  Free account: ${D.INVOIS.site}`));
    }

    // Short path when the office is below here, else the full path (npx may run from its cache folder).
    const r0 = path.relative(process.cwd(), dir);
    const rel = !r0 ? '.' : r0.startsWith('..') || path.isAbsolute(r0) ? dir : r0;
    const T = require('./templates'), distro = require('./generate').wslDistro();
    const launcher = T.launcher(process.execPath).name;
    const dash = distro // inside WSL: start it from a WSL terminal; it opens in the Windows browser
      ? `in a WSL terminal, run ${bold(`./${launcher}`)} in the office folder. It opens in your Windows browser.`
      : `double-click ${bold(launcher)} in the office folder.`;
    console.log(`\n${bold('Next:')}
  Dashboard: ${dash}
  Talk to ${pa}: open a terminal in the office folder and run claude:
    cd ${rel.includes(' ') ? `"${rel}"` : rel}
    claude
  The first time, Claude asks if you trust the folder: answer yes.\n`);

    // Typed the answers in a terminal? Open the dashboard now (Claude-run setups start it themselves).
    if (!opts.answers && !opts.noStart && process.stdin.isTTY) {
      const { start } = require('./server');
      const r = await start(dir);
      const url = `http://localhost:${r.port}`;
      console.log(`${green('✓')} Dashboard running at ${url} ${dim('(Ctrl+C to stop)')}`);
      if (opts.openBrowser) opts.openBrowser(url);
      const stop = async () => { if (r.close) await r.close(); process.exit(0); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      return new Promise(() => {});
    }
    return 0;
  }
}

module.exports = { wizard };
