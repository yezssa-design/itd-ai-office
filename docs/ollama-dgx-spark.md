# Run the IT office on a DGX Spark (Ollama, no Claude account)

AI Office runs every person through the Claude Code CLI. This fork points that CLI at
Ollama's Anthropic-compatible endpoint (Ollama 0.14 or newer), so nothing goes to Anthropic.
Switch it on with `AI_OFFICE_BACKEND=ollama`; without it the office behaves as upstream.

## 1. Ollama on the Spark

```bash
ollama --version                      # 0.14.0 or newer
ollama pull gpt-oss:120b              # Manager (opus)
ollama pull qwen3-coder:30b           # Staff (sonnet)
ollama pull gpt-oss:20b               # light background work (haiku)
```

Claude Code sends a large prompt with every request. Give Ollama a long context
(64k or more) and keep models loaded, e.g. in the Ollama service environment:

```
OLLAMA_CONTEXT_LENGTH=65536
OLLAMA_KEEP_ALIVE=1h
OLLAMA_MAX_LOADED_MODELS=2
```

Check with `ollama ps` that the context is what you set. These model names are defaults
only: swap any of them with `AI_OFFICE_MODEL_OPUS`, `_SONNET`, `_HAIKU`. Pick models that
call tools reliably, since staff read and write files through tool calls.

## 2. Claude Code CLI (only as the engine)

```bash
npm install -g @anthropic-ai/claude-code    # no login needed with Ollama
```

## 3. Create and start the IT office

```bash
./start-it-office.sh            # first run: creates ./it-office from presets/it-department.json
```

The dashboard is at http://localhost:4747. It listens on localhost only: from your PC use
`ssh -L 4747:localhost:4747 <spark>`.

## Who is in the office

| Person | Role | Does |
| --- | --- | --- |
| Iris | Manager | Takes your request, hands it to staff, checks the result |
| Zara | IT Policy | Drafts and maintains policies; nothing is "approved" until you OK it |
| Hakim | IT Security Analyst | Defensive, read-only review of logs, configs, findings; risk register |
| Ravi | Developer | Code in linked folders, on branches, with tests; git and node allowed |

Edit jobs, rules and commands on the dashboard's Staff page. Link your code or log folders there too.

## Known limits

- Quality depends on the local models. Test with a small task per person first.
- The usage bar and cost figures come from Claude plan limits and API prices; they mean nothing here.
- `git push`, `sudo`, `ssh`, `curl`, `rm` stay blocked for staff by the guard, as upstream.
- Staff answers are drafts. Review policies and security findings before acting on them.
