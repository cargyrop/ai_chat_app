const { Router } = require('express');
const path = require('path');
const { readFileTree, readFilesByPaths } = require('../services/fileTree');

const router = Router();

router.get('/', (req, res) => {
  try {
    const appDir = path.resolve(__dirname, '..', '..');
    const filesParam = req.query.files;
    if (filesParam) {
      // Smart file loading: return only the requested files (comma-separated paths)
      const requestedPaths = String(filesParam).split(',').map(p => p.trim()).filter(Boolean);
      const files = readFilesByPaths(appDir, requestedPaths);
      res.json({ files });
    } else {
      // Full tree fallback: return all files
      res.json(readFileTree(appDir));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
