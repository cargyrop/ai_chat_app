/* ARKEL — evolve patching utilities (split from evolveEngine.js, Phase 1B)
   Pure functions for patch parsing, application, content stripping, backup cleanup. */

const fs = require('fs');
const path = require('path');

const MAX_BACKUPS_TO_KEEP = 5;
const MAX_PLAN_ITEMS = 25;
const EVOLVE_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;

function cleanupOldBackups(parentDir, appName, currentBackupDir) {
  try {
    const entries = fs.readdirSync(parentDir)
      .filter(name => name.startsWith(`${appName}-backup-`))
      .map(name => ({ name, full: path.join(parentDir, name), mtime: fs.statSync(path.join(parentDir, name)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    const toDelete = entries.slice(MAX_BACKUPS_TO_KEEP).filter(e => e.full !== currentBackupDir);
    for (const e of toDelete) {
      try { fs.rmSync(e.full, { recursive: true, force: true }); } catch {}
    }
    return toDelete.length;
  } catch {
    return 0;
  }
}

function stripGeneratedFileContent(text, filePath) {
  let out = String(text || '').replace(/\r\n/g, '\n').trim();
  const fenced = out.match(/^```[\w-]*\n([\s\S]*?)\n```\s*$/);
  if (fenced) out = fenced[1].trim();
  out = out.replace(/^=== FILE:\s*.+?\s*===\n/i, '').trim();
  out = out.replace(/\n```\s*$/g, '').trim();
  return out;
}

function extractJsonObject(text) {
  let cleaned = String(text || '').replace(/\s*<arg_key>[\s\S]*?<\/think>\s*/gi, '').trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

function applySearchReplacePatch(original, changes, filePath) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error(`Edit patch for ${filePath} did not include any changes`);
  }
  let content = original;
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i] || {};
    if (typeof change.search !== 'string' || typeof change.replace !== 'string' || !change.search) {
      throw new Error(`Change ${i + 1} for ${filePath} must include non-empty search and replacement strings`);
    }
    const first = content.indexOf(change.search);
    if (first === -1) {
      throw new Error(`Search block ${i + 1} was not found in ${filePath}. The model must use exact current text with enough surrounding context.`);
    }
    if (content.indexOf(change.search, first + change.search.length) !== -1) {
      throw new Error(`Search block ${i + 1} matched multiple locations in ${filePath}. The model must include more surrounding context.`);
    }
    content = content.slice(0, first) + change.replace + content.slice(first + change.search.length);
  }
  return content;
}

module.exports = {
  cleanupOldBackups,
  stripGeneratedFileContent,
  extractJsonObject,
  applySearchReplacePatch,
  MAX_BACKUPS_TO_KEEP,
  MAX_PLAN_ITEMS,
  EVOLVE_EXECUTION_TIMEOUT_MS,
};
