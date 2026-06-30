# BLACKLINE AI — Architecture Overview (Phase 3)

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        USER                                  │
│  (Browser: localhost:3737)                                   │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTP / SSE                   │ File writes
               ▼                              ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│   Express Backend        │    │   Filesystem             │
│   (Node.js, port 3737)   │    │   data/config.json       │
│                          │    │   backups/               │
│   ┌─routes/              │    │   frontend/                │
│   ├─services/            │    │   backend/               │
│   ├─middleware/          │    └──────────────────────────┘
│   ├─providers/           │
│   ├─config/              │
│   └─utils/               │
└──────────┬───────────────┘
           │ HTTPS / SSE (fetch)
           ▼
┌─────────────────────────────────────────────────────────────┐
│                  AI PROVIDER APIs                              │
│  Anthropic │ OpenAI │ Gemini │ Groq │ OpenRouter │ DeepSeek │
│  Ollama (localhost:11434) │ Custom OpenAI-compatible         │
└─────────────────────────────────────────────────────────────┘
```

## Layer Responsibilities

### Backend (`backend/`)
| Layer | Responsibility | Never Does |
|-------|---------------|------------|
| `routes/` | Express HTTP handlers. Validate input, delegate to services, send JSON/SSE responses. | No business logic, no API calls to providers |
| `services/` | Core business logic. Call provider APIs, manage file trees, execute evolve plans, probe models. | No direct HTTP request/response manipulation |
| `middleware/` | Security headers, CSP, rate limiting, CORS. | No business logic |
| `config/` | Load/save `data/config.json`. Schema validation. | No provider logic |
| `providers/` | Provider-specific presets and metadata. | No runtime logic |
| `utils/` | Pure helper functions: string escaping, URL joining, path safety, model intelligence scoring. | No side effects, no I/O |

### Frontend (`frontend/modules/`)
| Module | Responsibility | DOM Targets |
|--------|---------------|-------------|
| `state.js` | Global mutable state: `models`, `conversations`, `currentConvId`, `evolveMessages`, etc. | None (data only) |
| `core.js` | Pure utilities: `escHtml`, `loadStoredJson`, `autoResize`, `flashCopied`. | None |
| `toast.js` | Toast notification queue and display. | `#toast` |
| `markdown.js` | Initialize `marked.js` + `hljs`. Convert markdown to HTML. | None (returns HTML strings) |
| `panels.js` | Panel visibility, modal open/close, system prompt save. | `#chat-panel`, `#settings-panel`, `#evolve-panel`, `#modal-overlay`, `#model-info-overlay` |
| `models.js` | Load model catalogs, populate selects, probe models, render Model Center. | `#model-select`, `#model-center-list`, `#evolve-model-select`, `.model-center-tabs` |
| `settings.js` | API key forms, custom provider forms, save/delete keys. | `#keys-list`, `#custom-providers-list`, `.custom-provider-form` |
| `conversations.js` | Conversation CRUD, sidebar rendering, search filter, rename. | `#conv-list`, `#conv-search`, `#new-chat-btn` |
| `chat_render.js` | Render chat bubbles, append messages, scroll, thinking toggle. | `#messages`, `.thinking-block` |
| `chat_send.js` | Send user message, stream AI response via SSE, stop generation. | `#msg-input`, `#send-btn`, `#stop-btn` |
| `chat_actions.js` | Edit/copy/regen message, clear chat, export, insert suggestion. | `.edit-msg`, `.copy-msg`, `.regen-msg`, `.suggestion` |
| `evolve_tree.js` | File tree viewer, resizer, file preview in evolve panel. | `#evolve-file-tree`, `#evolve-file-viewer`, `#evolve-resizer` |
| `evolve_messages.js` | Render evolve chat bubbles, loading states, save messages. | `#evolve-messages` |
| `evolve_plan.js` | Parse plan JSON, manage plan states, render approve/reject buttons, retry failed plans. | `#evolve-messages` (renders inline plan cards) |
| `evolve_send.js` | Send evolve message, stream response, approve plan execution, stop. | `#evolve-input`, `#evolve-send-btn`, `#evolve-stop-btn` |
| `data.js` | Import/export JSON backups, load app manifest, render manifest as prompt text. | None (file downloads + API calls) |

## Data Flow: Chat Message

```
User types → [chat_send.js] onInputKey / sendMessage
                │
                ▼
          POST /api/chat
                │
                ▼
          [backend/routes/chat.js] → [chatProxy.js] streamChat()
                │
                ▼
          Fetch AI provider API (SSE)
                │
                ▼
          SSE chunks → [chat_send.js] appendMessage('assistant', chunk)
                │
                ▼
          [chat_render.js] renderMessages() → DOM #messages
                │
                ▼
          [state.js] conversations updated → localStorage
```

## Data Flow: Evolve Plan Execution

```
User approves plan → [evolve_send.js] approvePlan(planId)
                │
                ▼
          POST /api/evolve/execute
                │
                ▼
          [backend/routes/evolve.js] → [evolveEngine.js] executePlan()
                │
                ▼
          1. Create backup (filesystem)
          2. Read file tree (filesystem)
          3. For each plan item: prompt AI → apply patch → write file
          4. Stream progress via SSE back to frontend
                │
                ▼
          [evolve_send.js] receives SSE → update evolve chat UI
```

## State Ownership

| State | Owner | Persistence |
|-------|-------|-------------|
| `models`, `modelProbes` | `models.js` | Memory (refreshed from APIs) |
| `conversations`, `currentConvId` | `conversations.js` + `chat_send.js` | `localStorage` |
| `currentModel` | `models.js` | `localStorage` |
| `systemPrompt` | `panels.js` | `localStorage` |
| `evolveMessages`, `evolvePlanStates` | `evolve_messages.js` + `evolve_send.js` | `localStorage` |
| `appManifest` | `data.js` | Memory (loaded on init) |
| API keys, custom providers | `settings.js` (UI) | `data/config.json` (server) |

## Module Dependency Rules

1. **No circular imports.** `utils/` → `config/` → `services/` → `routes/` is the dependency direction.
2. **Frontend modules are global-scope.** No ES6 imports. Scripts load in order via `<script>` tags. Each module can call any function defined in a previously-loaded module.
3. **State is global.** `state.js` defines all mutable state. Other modules read/write it directly. This is intentional for simplicity — no event bus, no redux.
4. **DOM is queried, not passed.** Functions query `document.getElementById` directly. Elements are expected to exist.

## File Size Limits (Enforced)

| Context | Limit | Why |
|---------|-------|-----|
| Plan items per evolve | 25 | Prevents unbounded AI runs |
| Conversations stored | 50 | localStorage quota |
| Conversation size | 4MB | localStorage quota |
| Evolve messages | 200 | localStorage quota |
| Backend module | ~400 lines | AI context window efficiency |
| Frontend module | ~350 lines | AI context window efficiency |
