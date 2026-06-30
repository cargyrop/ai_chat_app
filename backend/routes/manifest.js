const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { listVisibleEntries, joinRelPath } = require('../utils');

const router = Router();

const ENDPOINTS = [
  { method: 'GET', path: '/api/keys' },
  { method: 'POST', path: '/api/keys' },
  { method: 'DELETE', path: '/api/keys/:provider' },
  { method: 'GET', path: '/api/endpoints' },
  { method: 'POST', path: '/api/endpoints' },
  { method: 'POST', path: '/api/endpoints/test' },
  { method: 'PUT', path: '/api/endpoints/:id/toggle' },
  { method: 'PUT', path: '/api/endpoints/:id/models' },
  { method: 'DELETE', path: '/api/endpoints/:id' },
  { method: 'GET', path: '/api/arena' },
  { method: 'POST', path: '/api/arena/sync' },
  { method: 'GET', path: '/api/custom-providers' },
  { method: 'POST', path: '/api/custom-providers' },
  { method: 'DELETE', path: '/api/custom-providers/:id' },
  { method: 'GET', path: '/api/custom-provider-presets' },
  { method: 'GET', path: '/api/model-probes' },
  { method: 'POST', path: '/api/models/probe' },
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/models' },
  { method: 'POST', path: '/api/chat' },
  { method: 'GET', path: '/api/manifest' },
  { method: 'GET', path: '/api/files' },
  { method: 'POST', path: '/api/evolve/execute' },
];

router.get('/', (req, res) => {
  try {
    const appDir = path.resolve(__dirname, '..', '..');
    const serverSrc = fs.readFileSync(path.join(appDir, 'server.js'), 'utf8');
    const indexSrc = fs.readFileSync(path.join(appDir, 'frontend', 'index.html'), 'utf8');
    const appJsSrc = fs.existsSync(path.join(appDir, 'frontend', 'app.js'))
      ? fs.readFileSync(path.join(appDir, 'frontend', 'app.js'), 'utf8')
      : '';
    const stylesSrc = fs.existsSync(path.join(appDir, 'frontend', 'styles.css'))
      ? fs.readFileSync(path.join(appDir, 'frontend', 'styles.css'), 'utf8')
      : '';
    const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
    const readJsonIfExists = (relPath) => {
      const full = path.join(appDir, relPath);
      if (!fs.existsSync(full)) return null;
      try { return JSON.parse(fs.readFileSync(full, 'utf8')); } catch { return null; }
    };
    const backendManifest = readJsonIfExists('backend/manifest.json');
    const frontendManifest = readJsonIfExists('frontend/modules/frontend-manifest.json');
    const summarizeModules = (manifest) => Object.entries(manifest?.modules || {}).map(([name, mod]) => ({
      name,
      path: mod.path,
      exports: mod.exports,
      dependencies: mod.dependencies || [],
      domTargets: mod.domTargets || undefined,
      lines: mod.lines,
      description: mod.description
    }));

    const readFileMap = (dir, base = '') => {
      const out = [];
      for (const entry of listVisibleEntries(dir, ['node_modules', '.git', 'data', '.arena', '.cache', 'package-lock.json'])) {
        const full = path.join(dir, entry);
        const rel = joinRelPath(base, entry);
        if (fs.statSync(full).isDirectory()) out.push(...readFileMap(full, rel));
        else out.push({ path: rel, lines: fs.readFileSync(full, 'utf8').split('\n').length });
      }
      return out;
    };

    const panels = [...new Set([...indexSrc.matchAll(/data-panel="([^"${}]+)"/g)].map(m => m[1]))];
    const navItems = [...indexSrc.matchAll(/<button[^>]*class="[^"]*nav-btn[^"]*"[^>]*data-panel="([^"]+)"[\s\S]*?<\/button>/g)]
      .map(match => ({
        panel: match[1],
        label: match[0]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
        source: 'frontend/index.html'
      }));
    const functions = [...new Set([...appJsSrc.matchAll(/function\s+(\w+)\s*\(/g)].map(m => m[1]))].sort();

    res.json({
      name: pkg.name,
      description: pkg.description,
      version: pkg.version,
      techStack: ['Node.js + Express backend (modular: backend/routes/ + backend/services/ + backend/middleware/ + backend/config/ + backend/utils/)', 'vanilla HTML/CSS/JS frontend (frontend/index.html + frontend/styles.css + frontend/modules/*.js + frontend/app.js bootstrap)', 'no build step', 'Server-Sent Events for streaming chat and updates'],
      port: 3737,
      storage: {
        apiKeys: 'data/config.json (local disk, never sent anywhere except the provider APIs)',
        conversations: 'browser localStorage (per-device)',
        backups: 'a sibling folder like ../Blackline_AI-backup-<timestamp>/ created automatically before every update'
      },
      files: readFileMap(appDir),
      endpoints: ENDPOINTS,
      frontend: {
        panels,
        navItems,
        functions,
        lineCount: indexSrc.split('\n').length,
        scriptLineCount: appJsSrc ? appJsSrc.split('\n').length : 0,
        styleLineCount: stylesSrc ? stylesSrc.split('\n').length : 0,
        keySelectors: ['#messages', '#msg-input', '#model-select', '#toolbar', '#system-prompt-input', '#keys-list', '#evolve-panel', '#evolve-messages', '#evolve-input', '#evolve-model-select', '#evolve-file-tree']
      },
      architecture: {
        backendManifest: 'backend/manifest.json',
        frontendManifest: 'frontend/modules/frontend-manifest.json',
        backendModules: summarizeModules(backendManifest),
        frontendModules: summarizeModules(frontendManifest)
      },
      capabilities: [
        'Evolve server.js and any frontend/backend file via the Evolve App panel (guided planning + approval workflow).',
        'Create new files anywhere in the app folder (except blocked directories).',
        'Edit existing files using search/replace diffs (preferred) or full rewrites when necessary.',
        'Delete existing files.',
        'Add new UI panels, sidebar buttons, settings, modals, toasts.',
        'Add new API endpoints (express routes), modify existing ones.',
        'Change CSS / theme variables (--accent, --bg, etc. are CSS custom properties near the top of frontend/styles.css).',
        'Use the existing markdown renderer (formatMd) — code blocks render with a Copy button.',
        'Persist small client state via localStorage (already used for conversations, systemPrompt, and Evolve layout preferences).',
        'Stream both chat responses and update progress via Server-Sent Events.'
      ],
      hardConstraints: [
        'Cannot add new npm dependencies automatically. If you need one, the user must run `npm install <pkg>` themselves; after that the app can require() it.',
        'Cannot run arbitrary shell commands or user-controlled code. The only current command exceptions are opening the browser on startup and the fixed `npm test` verification path in Evolve.',
        'Files outside the app folder are rejected (safeResolve blocks path traversal).',
        'node_modules, .git, and data/ folders cannot be modified or created.'
      ],
      updateWorkflow: [
        '1. User opens the Evolve App panel, selects a capable model, and asks a question or describes a desired change.',
        '2. The Evolve AI (chat inside the panel) discusses the request, analyzes feasibility, and can propose a structured plan using a fenced ```plan JSON block.',
        '3. The user reviews the proposed plan directly in the chat and clicks "Approve & Execute" to confirm.',
        '4. The server creates a timestamped backup, then calls the AI to generate the actual code for each file in the plan.',
        '5. The server streams the live code generation back to the client in real-time. The user sees exactly which file is being written and what code is being generated.',
        '6. The server writes each file to disk as it is generated.',
        '7. User reloads the browser tab. If server.js changed, the user restarts the Node process to pick up backend changes.'
      ],
      updatePromptGuide: {
        what_makes_a_great_prompt: [
          'State ONE clear feature (not three at once).',
          'Describe visible user behavior, not low-level implementation when possible.',
          'List exactly which files/modules should change (for example frontend/modules/models.js, frontend/modules/evolve_send.js, backend/routes/models.js, frontend/styles.css, or a new file).',
          'Specify UI placement: "in the chat header next to the existing buttons", "as a new sidebar nav item", etc.',
          'Mention constraints: "preserve existing functionality", "follow existing CSS variable names", "do not add new dependencies".',
          'If multiple providers/models are involved, specify each one\'s role.',
          'Be concrete about edge cases: empty input, long text, streaming already in progress, etc.',
          'Avoid vague verbs ("improve", "optimize") — replace with measurable behavior ("reduce time to first token by streaming headers earlier").'
        ],
        format: 'When the user agrees on a feature, your FINAL reply should end with EXACTLY one fenced code block whose opening fence is ```plan and whose content is a JSON array of proposed actions. The frontend will detect this block and render an inline Approve & Execute button.',
        example: 'Add a "Rename conversation" action to each item in the left sidebar conversation list.\n\nUI behavior:\n- Right-clicking (or hovering + clicking a small pencil icon) a conversation item opens a small inline text input pre-filled with the current title.\n- Pressing Enter saves the new title and updates localStorage.\n- Pressing Escape cancels.\n- Empty titles are rejected.\n\nFiles to change: prefer focused modules such as frontend/modules/conversations.js, frontend/modules/models.js, frontend/styles.css, backend/routes/*.js, backend/services/*.js, or new files as needed.\nConstraints: preserve all existing chat, settings, and update-panel behavior; reuse the existing CSS variables (--accent, --surface2, etc.); do not add new dependencies.'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
