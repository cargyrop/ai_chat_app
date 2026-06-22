# BLACKLINE AI — Local Multi-Provider Chat & Self-Evolving App

A clean, self-contained chat interface for multiple AI providers and local models,
with a built-in **Evolve** panel that lets a capable model read, plan, and rewrite
its own codebase — under your explicit approval.

Runs entirely on your machine. Your API keys never leave your computer (sent only
to the respective provider's API).

> **Current version: v1.4.2** — see [`FIXES.md`](FIXES.md) for what changed.

---

## Quick Start

### Windows
Double-click **START.bat**

### Mac / Linux
Right-click **start.sh** → Open With → Terminal
(Or run: `chmod +x start.sh && ./start.sh` once)

That's it. The app opens in your browser at **http://localhost:3737**

> **Only prerequisite:** Node.js (free, one-time install)
> Download from https://nodejs.org — choose the LTS version
> After installing Node.js, double-click the launcher and it handles everything else.

### Configurable port
Set `PORT=8080` (or any port) before running, or change the constant in `server.js`.

---

## Supported AI Providers

| Provider | Icon | Where to get a key |
|---|---|---|
| Anthropic (Claude) | ◖ | https://console.anthropic.com |
| OpenAI (GPT-4 etc.) | ◎ | https://platform.openai.com/api-keys |
| Google Gemini | ◇ | https://aistudio.google.com/app/apikey |
| Groq (fast inference) | ⚡ | https://console.groq.com |
| OpenRouter (many models) | ⬡ | https://openrouter.ai/keys |
| DeepSeek | ▽ | https://platform.deepseek.com |

### OpenAI-compatible custom providers (Settings → Custom Providers)
Kimi/Moonshot, Qwen/DashScope, Mistral, Together, Fireworks, xAI/Grok, LM Studio,
vLLM, llama.cpp — fill in name + base URL + key. They use the OpenAI chat API
schema. Pick a preset from the dropdown to auto-fill the base URL.

## Local Models (no API key needed)

1. Install Ollama: https://ollama.com
2. Open a terminal and run: `ollama pull llama3.2`
3. Click **REFRESH MODEL CATALOG** in the toolbar

Popular local models:
- `ollama pull llama3.2`      — Meta's Llama 3.2 (3B, fast)
- `ollama pull mistral`       — Mistral 7B
- `ollama pull gemma2`        — Google Gemma 2
- `ollama pull phi3`          — Microsoft Phi-3 (small & capable)
- `ollama pull deepseek-r1`   — DeepSeek R1

---

## Model Center & Probing

Every selectable model is verified by a live **probe** before it appears in the
chat dropdown. Probes test four things:
- Basic chat (the model responds coherently)
- JSON output (the model produces parseable JSON)
- Evolve plan generation (writes a fenced `plan` block correctly)
- Evolve patch generation (produces a search/replace JSON patch)

After adding an API key or clicking **REFRESH MODEL CATALOG**, any newly-discovered
model is **probed automatically in the background**. You don't have to click TEST
for each one. If a probe fails, the model stays in Model Center but isn't
selectable in the chat dropdown.

---

## Evolving the App

> **Important safety note:** Plans only execute when you click the **APPROVE &
> EXECUTE** button. Typing words like "yes" or "proceed" does NOT execute a plan.
> See [`FIXES.md`](FIXES.md) for context.

1. Go to **Evolve App** in the sidebar
2. Select a capable AI model and start a conversation about what you want
3. The AI will analyze the codebase, discuss feasibility, and propose a structured plan directly in the chat
4. Review the plan — it will show each file action (create, edit, or delete) with an inline **APPROVE & EXECUTE** button
5. Click **APPROVE & EXECUTE** to confirm
6. Watch the live feed in the chat — you will see the code being written file by file in real time

The app automatically:
- Creates a timestamped backup folder next to the app folder before any changes
- **Keeps only the 5 most recent backups** (older ones are pruned to bound disk usage)
- Validates all file paths before writing (blocks `..`, absolute paths, blocked dirs)
- Writes files to disk as the AI generates them, while streaming the live output to you
- **Rejects plans with more than 25 file actions** to avoid unbounded runs

Reload the page after updating to see changes. If `server.js` changed, restart the Node process.

---

## File Structure

```
Blackline_AI/
├── START.bat                 ← Windows launcher (double-click)
├── start.sh                  ← Mac/Linux launcher
├── server.js                 ← Express backend (single file, ~1600 lines)
├── package.json
├── package-lock.json
├── README.md                 ← This file
├── FIXES.md                  ← Changelog for v1.4.0
├── data/
│   └── config.json           ← API keys, custom providers, model probes
└── public/
    ├── index.html            ← Frontend HTML shell
    ├── app.js                ← Frontend app logic (single file)
    ├── styles.css            ← UI / theme
    ├── manifest.json         ← PWA manifest
    └── vendor/
        ├── marked.min.js     ← Markdown renderer
        ├── highlight.min.js  ← Code highlighter
        └── highlight-github-dark.min.css
```

> The previous "Phase 3 modular frontend" (the `public/js/` folder) was removed
> in v1.4.0 — it was scaffolding from an unfinished refactor, not actually
> loaded by `index.html`.

---

## Security & Privacy Notes

- **Port:** 3737 by default; configurable via `PORT` env var or `server.js`
- **Keys stored:** `data/config.json` — gitignore this if you use git
- **Conversations:** stored in your browser's `localStorage` (per-device)
- **Backups:** created at `../Blackline_AI-backup-<timestamp>/` (max 5 kept)
- **CSP:** tight; `script-src 'self' 'unsafe-inline'` (required because `index.html`
  uses inline event handlers — `onclick`, `onkeydown`, etc. — on dozens of
  elements). No telemetry, no analytics, no external fonts/scripts. The
  long-term plan is to refactor inline handlers to `addEventListener`, after
  which `'unsafe-inline'` can be removed from `script-src`.
- **CORS:** limited to localhost origins
- **Path safety:** `/api/evolve/execute` blocks `..`, absolute paths, and writes
  to `node_modules`, `.git`, `data`, `.env`, `dist`, `build`, `coverage`
- **Rate limit:** 90 req/min/IP on the global limiter

API keys are intentionally excluded from the EXPORT backup feature.

---

## Token Counter

The toolbar shows tokens spent per conversation (prompt in / completion out).
For custom OpenAI-compatible providers that don't include `stream_options.usage`,
the count is **estimated from text length / 4** and labeled `(est.)`.

---

## Vision Support (status)

Capability badges correctly identify models with vision support, and the Model
Center has a "Vision" filter tab. **Actual image upload is not wired up** —
that was a half-built feature in earlier versions and the orphan server helper
was removed in v1.4.0. If you want real vision support, that's a deliberate
feature to build (multipart uploads, file storage policy, UI) rather than a
quick retrofit.

---

## License

MIT.
