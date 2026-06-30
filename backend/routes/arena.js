const { Router } = require('express');
const { getArenaCache, fetchArenaLeaderboards } = require('../services/arenaSync');

const router = Router();

router.get('/', async (req, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  const cache = await getArenaCache({ force, refreshIfStale: true });
  if (!cache) return res.status(503).json({ error: 'Arena leaderboard cache is unavailable' });
  res.json(cache);
});

router.post('/sync', async (req, res) => {
  try {
    const cache = await fetchArenaLeaderboards();
    res.json({ ok: true, cache });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

module.exports = router;
