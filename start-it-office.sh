#!/usr/bin/env bash
# Start (or first create) the IT department office on local Ollama models.
set -euo pipefail
cd "$(dirname "$0")"
export AI_OFFICE_BACKEND=ollama
: "${OLLAMA_URL:=http://localhost:11434}"; export OLLAMA_URL
OFFICE="${OFFICE_DIR:-./it-office}"
if [ -f "$OFFICE/office.json" ]; then
  exec node bin/ai-office.js --dir "$OFFICE"
else
  exec node bin/ai-office.js --answers presets/it-department.json --dir "$OFFICE"
fi
