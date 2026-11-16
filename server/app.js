'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { createAuth } = require('./auth');
const { createParticipantRouter } = require('./routes/participant');
const { createAdminRouter } = require('./routes/admin');
const { getProvider } = require('./whatsapp');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

function createApp(options = {}) {
  const db = options.db;
  const adminPassword = options.adminPassword || process.env.ADMIN_PASSWORD;
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET;
  if (!db) throw new Error('createApp requiere una base de datos.');
  if (!adminPassword) throw new Error('ADMIN_PASSWORD es obligatoria.');
  if (!sessionSecret || String(sessionSecret).length < 32) {
    throw new Error('SESSION_SECRET es obligatoria y debe tener al menos 32 caracteres.');
  }

  const publicUrl = String(
    options.publicUrl || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,
  ).replace(/\/+$/, '');
  const exclusionsPath =
    options.exclusionsPath || path.join(ROOT_DIR, 'config', 'exclusions.json');
  const participantsPath =
    options.participantsPath || path.join(ROOT_DIR, 'config', 'participants.json');
  const backupDir =
    options.backupDir || path.join(path.dirname(db.name || path.resolve('data', 'app.db')), 'backups');
  const trustProxy =
    options.trustProxy !== undefined
      ? options.trustProxy
      : process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

  getProvider();

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  const auth = createAuth({ publicUrl, sessionSecret });
  app.use(auth.csrf);
  app.use(express.json({ limit: '128kb' }));

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/admin', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/healthz', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
  });

  app.use('/api', createParticipantRouter(db, { sessionSecret }));
  app.use(
    '/admin',
    createAdminRouter({
      db,
      auth,
      exclusionsPath,
      participantsPath,
      backupDir,
      publicUrl,
      adminPassword,
      sessionSecret,
    }),
  );

  app.use(
    express.static(PUBLIC_DIR, {
      index: 'index.html',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Recurso no encontrado.' });
  });

  app.use((req, res) => {
    res.status(404).type('text/plain').send('No encontrado');
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error && (error.type === 'entity.parse.failed' || error instanceof SyntaxError)) {
      return res.status(400).json({ error: 'Solicitud no válida.' });
    }
    if (error && error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'La solicitud es demasiado grande.' });
    }
    if (process.env.NODE_ENV !== 'test') {
      console.error(
        `[error] ${req.method} ${req.path} (${error && error.name ? error.name : 'Error'})`,
      );
    }
    return res.status(500).json({ error: 'Ocurrió un error inesperado.' });
  });

  return app;
}

module.exports = { createApp };
