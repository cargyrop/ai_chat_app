const fs = require('fs');
const path = require('path');
const { toPosixPath, joinRelPath, listVisibleEntries, safeResolve } = require('../utils');

function readFileMap(dir, base = '') {
  const out = [];
  for (const entry of listVisibleEntries(dir, ['node_modules', '.git', 'data', '.arena', '.cache', 'package-lock.json'])) {
    const full = path.join(dir, entry);
    const rel = joinRelPath(base, entry);
    if (fs.statSync(full).isDirectory()) out.push(...readFileMap(full, rel));
    else out.push({ path: rel, lines: fs.readFileSync(full, 'utf8').split('\n').length });
  }
  return out;
}

function readFileTree(dir, base = '') {
  const results = [];
  for (const entry of listVisibleEntries(dir, ['node_modules', '.git', 'data', '.arena', '.cache', 'package-lock.json', 'dist', 'build', 'coverage'])) {
    const full = path.join(dir, entry);
    const rel = joinRelPath(base, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push({ path: rel, type: 'dir', children: readFileTree(full, rel) });
    } else {
      const content = fs.readFileSync(full, 'utf8');
      results.push({ path: rel, type: 'file', content, lines: content.split('\n').length });
    }
  }
  return results;
}

function readFilesByPaths(appDir, relPaths) {
  const files = [];
  for (const relPath of relPaths) {
    const target = safeResolve(appDir, relPath);
    if (!target) continue;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
    const content = fs.readFileSync(target, 'utf8');
    files.push({ path: relPath, type: 'file', content, lines: content.split('\n').length });
  }
  return files;
}

module.exports = {
  readFileMap,
  readFileTree,
  readFilesByPaths,
};
