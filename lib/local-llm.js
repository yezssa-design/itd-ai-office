// Local model backend (Ollama, e.g. on a DGX Spark) for the Claude Code CLI that runs every
// manager and staff. Nothing here talks to Anthropic: Claude Code is pointed at Ollama's
// Anthropic-compatible endpoint with environment variables, and its model names (opus, sonnet,
// haiku) are mapped to Ollama models. Off unless AI_OFFICE_BACKEND=ollama.
//
//   AI_OFFICE_BACKEND=ollama
//   OLLAMA_URL=http://localhost:11434          (default)
//   AI_OFFICE_MODEL_OPUS=gpt-oss:120b          manager (default)
//   AI_OFFICE_MODEL_SONNET=qwen3-coder:30b     staff (default)
//   AI_OFFICE_MODEL_HAIKU=gpt-oss:20b          light background work (default)

const http = require('http');
const https = require('https');

const DEFAULTS = { url: 'http://localhost:11434', opus: 'gpt-oss:120b', sonnet: 'qwen3-coder:30b', haiku: 'gpt-oss:20b' };

const enabled = (env = process.env) => /^(ollama|local)$/i.test(env.AI_OFFICE_BACKEND || '');

function settings(env = process.env) {
  return {
    url: (env.OLLAMA_URL || DEFAULTS.url).replace(/\/+$/, ''),
    opus: env.AI_OFFICE_MODEL_OPUS || DEFAULTS.opus,
    sonnet: env.AI_OFFICE_MODEL_SONNET || DEFAULTS.sonnet,
    haiku: env.AI_OFFICE_MODEL_HAIKU || DEFAULTS.haiku,
  };
}

// Variables to add to every Claude Code run. Empty when the backend is off.
function envFor(env = process.env) {
  if (!enabled(env)) return {};
  const s = settings(env);
  return {
    ANTHROPIC_BASE_URL: s.url,
    ANTHROPIC_AUTH_TOKEN: 'ollama', // required by Claude Code, ignored by Ollama
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_DEFAULT_OPUS_MODEL: s.opus,
    ANTHROPIC_DEFAULT_SONNET_MODEL: s.sonnet,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: s.haiku,
    ANTHROPIC_SMALL_FAST_MODEL: s.haiku,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', // no telemetry, update checks or other outside calls
  };
}

// Is Ollama answering, and which of our three models are pulled? Never throws.
function ping(env = process.env, timeoutMs = 4000) {
  const s = settings(env);
  return new Promise((resolve) => {
    let u;
    try { u = new URL(`${s.url}/api/tags`); } catch { return resolve({ ok: false, error: `OLLAMA_URL is not a valid address: ${s.url}`, missing: [] }); }
    const req = (u.protocol === 'https:' ? https : http).get(u, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const have = (JSON.parse(body).models || []).map((m) => m.name);
          const hasModel = (want) => have.some((h) => h === want || h === `${want}:latest`);
          const missing = [...new Set([s.opus, s.sonnet, s.haiku])].filter((m) => !hasModel(m));
          resolve({ ok: res.statusCode === 200, url: s.url, models: have, missing });
        } catch { resolve({ ok: false, error: `${s.url} answered, but it does not look like Ollama.`, missing: [] }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: `No answer from ${s.url} (timeout).`, missing: [] }); });
    req.on('error', (e) => resolve({ ok: false, error: `Cannot reach Ollama at ${s.url}: ${e.code || e.message}`, missing: [] }));
  });
}

module.exports = { DEFAULTS, enabled, settings, envFor, ping };
