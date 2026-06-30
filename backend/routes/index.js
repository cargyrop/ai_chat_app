const express = require('express');
const fs = require('fs');
const path = require('path');
const keys = require('./keys');
const customProviders = require('./customProviders');
const health = require('./health');
const models = require('./models');
const chat = require('./chat');
const manifest = require('./manifest');
const files = require('./files');
const endpoints = require('./endpoints');
const arena = require('./arena');
const evolve = require('./evolve');
const { getProbes, postProbe } = require('./probes');

function renderIndexWithAssetVersion(app) {
  const indexPath = path.join(__dirname, '..', '..', 'frontend', 'index.html');
  const version = encodeURIComponent(app.locals.assetVersion || `dev-${Date.now().toString(36)}`);
  const html = fs.readFileSync(indexPath, 'utf8');
  return html.replace(/\b(src|href)="(\/(?:app\.js|styles\.css|modules\/[^"?]+\.js|vendor\/[^"?]+\.(?:js|css)))"/g, `$1="$2?v=${version}"`);
}

function mountRoutes(app) {
  app.use('/api/keys', keys);
  app.use('/api/custom-providers', customProviders);
  app.get('/api/custom-provider-presets', (req, res) => {
    // Re-export from customProviders module for convenience
    const { CUSTOM_PROVIDER_PRESETS } = require('../providers/presets');
    res.json(CUSTOM_PROVIDER_PRESETS);
  });
  app.use('/api/health', health);
  app.use('/api/models', models);
  app.get('/api/model-probes', getProbes);
  app.post('/api/models/probe', postProbe);
  app.use('/api/chat', chat);
  app.use('/api/manifest', manifest);
  app.use('/api/files', files);
  app.use('/api/endpoints', endpoints);
  app.use('/api/arena', arena);
  app.use('/api/evolve', evolve);
  app.get('*', (req, res) => {
    res.type('html').send(renderIndexWithAssetVersion(app));
  });
}

module.exports = mountRoutes;
