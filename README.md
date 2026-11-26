# ITD AI Office

A virtual office for the IT Department, running on our own **DGX Spark** with **Ollama**. No Claude account and no cloud: the models, the files and the approvals all stay on our hardware.

You talk to one manager (Iris). She hands the work to the right specialist, checks the result and reports back. You watch it in a live office in your browser, and anything important waits for your OK.

![The ITD AI Office dashboard: a live 3D office, the work board and the chat with the manager](docs/images/office.jpg)

Forked from [epool86/ai-office](https://github.com/epool86/ai-office) (MIT). This fork swaps the Claude backend for local Ollama models and replaces the default staff with an IT team.

## The team

| Person | Role | What they do |
|---|---|---|
| **Iris** | Manager | Takes your request, hands it to staff, checks the result, reports back |
| **Zara** | IT Policy | Drafts, reviews and maintains IT policies, standards and procedures (acceptable use, access control, passwords, backup, incident response, remote work, vendors) |
| **Hakim** | IT Security Analyst | Reviews logs, alerts, configs and vulnerability reports; triages by risk; keeps the risk register; writes incident reports and fix recommendations |
| **Ravi** | Developer | Builds and fixes internal tools, scripts and automation in linked code folders; reviews code; writes tests and docs |

Each person has rules you can edit on the **Staff** page:

- **Zara:** every policy is a draft until you approve it. Each carries a version, date, owner and review date, and goes through **Needs your OK** before it is shared.
- **Hakim:** defensive and read-only. He never scans or probes a system unless the task names the target and you approved it in writing. He masks secrets and personal data, rates each finding with evidence, and stops and asks you on anything critical.
- **Ravi:** works only in the office or a linked folder, on a branch (never `main`), tests before saying done, keeps secrets out of code, and asks before deploying, touching production or adding a dependency. Allowed commands: git and node.

## What you get

Staff produce real files in the office folder: policies and reports as Word (`.docx`) or PDF, risk registers and inventories as Excel (`.xlsx`), briefings as PowerPoint (`.pptx`), plus Markdown notes and code in linked repos. File paths in the chat are clickable.

## Requirements

- DGX Spark with **Ollama 0.14 or newer** (Anthropic-compatible API)
- Node.js 18+
- The Claude Code CLI installed as the engine only (`npm install -g @anthropic-ai/claude-code`). No login is needed, since it talks to Ollama.

## Setup

Full steps are in [docs/ollama-dgx-spark.md](docs/ollama-dgx-spark.md). In short:

```bash
# 1. Models on the Spark
ollama pull gpt-oss:120b        # Manager
ollama pull qwen3-coder:30b     # Staff
ollama pull gpt-oss:20b         # light background work

# 2. Long context for Ollama (64k or more), then confirm with `ollama ps`
OLLAMA_CONTEXT_LENGTH=65536

# 3. Create (first run) and start the office
./start-it-office.sh
```

The dashboard opens at http://localhost:4747. It listens on localhost only, so from your PC use `ssh -L 4747:localhost:4747 <spark>`.

Settings (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `AI_OFFICE_BACKEND` | `ollama` (set by the start script) | Turns on the local backend |
| `OLLAMA_URL` | `http://localhost:11434` | Where Ollama runs |
| `AI_OFFICE_MODEL_OPUS` | `gpt-oss:120b` | Manager model |
| `AI_OFFICE_MODEL_SONNET` | `qwen3-coder:30b` | Staff model |
| `AI_OFFICE_MODEL_HAIKU` | `gpt-oss:20b` | Light background work |
| `OFFICE_DIR` | `./it-office` | Office folder |

Choose models that call tools reliably: staff read and write files through tool calls. The names above are defaults, not tested picks.

## Using it

| Where | What |
|---|---|
| **Office** | The live office: who is working, on what, and who waits for you. The work board (top left) lists running tasks with a Stop button. |
| **Chat** (bottom right) | Talk to Iris, or to any staff directly. |
| **Needs your OK** (top right) | Policies for approval, and anything else that leaves the office, waits here for Approve or Reject. |
| **Staff** | Each person's job, rules, model and allowed commands. Link your code and log folders here. |
| **Projects, Inbox** | One folder per project with notes; requests waiting for the team. |

You can also run `claude` inside the office folder and talk to Iris in the terminal.

## What staff can and cannot touch

| | |
|---|---|
| Files | Only the office folder and folders you link. Everything else is refused. |
| Office rules | Staff cannot change their own rules, the office settings or the approvals log. |
| Commands | Only what you tick per person, checked by a guard script before every command. `git push`, `reset --hard`, `rm`, `curl`, `wget`, `ssh`, `scp` and `sudo` are always blocked. |
| Data | Stays on the Spark. No logins or passwords are stored. Models run locally. |

The guard and hooks are short, readable files in the office folder (`.office/guard.js`, `.office/hook.js`).

## Known limits

- Output quality depends on the local models. Try a small task with each person first.
- The usage bar and cost figures come from Claude plan limits and API prices, so they mean nothing here.
- Everything staff write is a draft. A person reviews policies and security findings before acting on them.

## Repo layout

| Path | Purpose |
|---|---|
| `lib/local-llm.js` | Points the Claude Code CLI at Ollama and maps model names |
| `lib/defaults.js` | Default staff, including the IT team (`IT_STAFF`) |
| `presets/it-department.json` | Answers file that creates the IT office |
| `start-it-office.sh` | Creates or starts the office on Ollama |
| `docs/ollama-dgx-spark.md` | Spark and Ollama setup |
| `test/` | Tests (`npm test`) |

To pull in upstream changes: `git remote add upstream https://github.com/epool86/ai-office.git`, then `git fetch upstream` and merge.

## License

MIT. See [LICENSE](LICENSE). Original work by epool86.
