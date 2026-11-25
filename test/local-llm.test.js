// Local (Ollama) backend: env mapping, effort flag, and the reachability check.
const assert = require('assert');
const http = require('http');
const L = require('../lib/local-llm');

assert.strictEqual(L.enabled({}), false);
assert.deepStrictEqual(L.envFor({}), {}); // off: adds nothing
assert.strictEqual(L.enabled({ AI_OFFICE_BACKEND: 'ollama' }), true);

const e = L.envFor({ AI_OFFICE_BACKEND: 'ollama', OLLAMA_URL: 'http://spark:11434/', AI_OFFICE_MODEL_SONNET: 'x:1' });
assert.strictEqual(e.ANTHROPIC_BASE_URL, 'http://spark:11434'); // trailing slash dropped
assert.strictEqual(e.ANTHROPIC_DEFAULT_SONNET_MODEL, 'x:1');
assert.strictEqual(e.ANTHROPIC_DEFAULT_OPUS_MODEL, L.DEFAULTS.opus);
assert.strictEqual(e.ANTHROPIC_API_KEY, '');
assert.strictEqual(e.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');

(async () => {
  const srv = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ models: [{ name: 'gpt-oss:120b' }, { name: 'qwen3-coder:30b' }] }));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const ok = await L.ping({ OLLAMA_URL: url });
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.missing, ['gpt-oss:20b']); // haiku model not pulled
  srv.close();
  const down = await L.ping({ OLLAMA_URL: url }, 1500);
  assert.strictEqual(down.ok, false);
  console.log('local-llm tests passed');
})();
