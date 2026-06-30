const { Router } = require('express');
const { executePlan } = require('../services/evolveEngine');

const router = Router();

router.post('/execute', async (req, res) => {
  const port = parseInt(process.env.PORT, 10) || 3737;
  await executePlan(port, req, res);
});

module.exports = router;
