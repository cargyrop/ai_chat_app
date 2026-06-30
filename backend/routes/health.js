const { Router } = require('express');
const router = Router();

router.get('/', (req, res) => {
  res.json({ ok: true, version: '1.4.2', time: new Date().toISOString() });
});

module.exports = router;
