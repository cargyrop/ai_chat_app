/* BLACKLINE AI — state module (Phase 2) */

/* BLACKLINE AI — app.js v1.4.2
   Stability + safety pack
   - marked.js + highlight.js markdown
   - conversation rename + search filter
   - Enter to send / Shift+Enter newline
   - Esc to close modal, keyboard nav
   - model select persistence
   - stop race fix, copy button class toggle
   - a11y improvements
   - removed dangerous "approval phrase" auto-detector (v1.4.0)
   - safer data-* attribute payload passing for plan retries (v1.4.0)
   - token counter labels estimates (v1.4.0)
   - auto-probe new models in background (v1.4.0)
   - v1.4.1: CSP regression fixed in server.js
   - v1.4.2: toast() inlined into app.js (was a separate file that got
             accidentally deleted during dead-code removal — caused every
             saveKey/probe call to throw ReferenceError)
*/

/* ── Toast queue (inlined, v1.4.2) ────────────────────────────────────────
   Previously lived in a legacy toast module. Inlined here so it can't be
   accidentally removed again — every other module's code calls toast(),
   and the file MUST exist for the app to function. */
let toastQueue = [];
let toastTimer = null;
let isToastShowing = false;


/* ── State ──────────────────────────────────────────────────────────────────── */
let models = [];
let modelProbes = {};
let modelCenterFilter = 'all';
let modelRoles = loadStoredJson('modelRoles', {});
if (!modelRoles || typeof modelRoles !== 'object' || Array.isArray(modelRoles)) modelRoles = {};
let providerTableCollapsed = loadStoredJson('providerTableCollapsed', {});
if (!providerTableCollapsed || typeof providerTableCollapsed !== 'object' || Array.isArray(providerTableCollapsed)) providerTableCollapsed = {};
let customProviderPresets = [];
let currentModel = loadStoredJson('currentModel', null);
let conversations = loadStoredJson('conversations', []);
if (!Array.isArray(conversations)) conversations = [];
let currentConvId = null;
let convSearchFilter = '';
let systemPrompt = localStorage.getItem('systemPrompt') || '';
let appManifest = null;
let appManifestString = '';
let streaming = false;
let activeAbortController = null;

const PROVIDERS = [
  { id: 'anthropic',  label: 'Anthropic',   icon: '◖', placeholder: 'sk-ant-...' },
  { id: 'openai',     label: 'OpenAI',       icon: '◎', placeholder: 'sk-...' },
  { id: 'gemini',     label: 'Google Gemini',icon: '◇', placeholder: 'AIzaSy...' },
  { id: 'groq',       label: 'Groq',         icon: '⚡', placeholder: 'gsk_...' },
  { id: 'openrouter', label: 'OpenRouter',   icon: '⬡', placeholder: 'sk-or-...' },
  { id: 'deepseek',   label: 'DeepSeek',     icon: '▽', placeholder: 'sk-...' },
];

/* ── Markdown (marked + highlight.js) ───────────────────────────────────────── */
let mdReady = false;


/* ── Init ───────────────────────────────────────────────────────────────────── */

/* ── Evolve state ───────────────────────────────────────────────────────── */
let evolveMessages = loadStoredJson('evolveMessages', []);
if (!Array.isArray(evolveMessages)) evolveMessages = [];
let evolvePlanStates = loadStoredJson('evolvePlanStates', {});
if (!evolvePlanStates || typeof evolvePlanStates !== 'object' || Array.isArray(evolvePlanStates)) evolvePlanStates = {};
let evolveStreaming = false;
let evolveAbortController = null;

/* ── Conversation UI state ─────────────────────────────────────────────── */
let renamingConvId = null;
