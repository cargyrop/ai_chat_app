const { Router } = require('express');
const { loadConfig } = require('../config');
const { streamChat } = require('../services/chatProxy');

const router = Router();

router.post('/', async (req, res) => {
  const cfg = loadConfig();
  await streamChat(req, res, cfg);
});

module.exports = router;
