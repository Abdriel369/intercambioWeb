'use strict';

const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv');

const ROOT_DIR = path.resolve(__dirname, '..');
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const { initDatabase } = require('./db');
const { createApp } = require('./app');
const { getProvider } = require('./whatsapp');

if (!process.env.ADMIN_PASSWORD) {
  console.error(
    'Falta ADMIN_PASSWORD. Copia .env.example a .env y define una contraseña segura antes de iniciar.',
  );
  process.exit(1);
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error(
    'Falta SESSION_SECRET o es demasiado corta (mínimo 32 caracteres). Copia .env.example a .env y genera una cadena aleatoria.',
  );
  process.exit(1);
}

let provider;
try {
  provider = getProvider();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error('PORT debe ser un número válido entre 1 y 65535.');
  process.exit(1);
}

const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || './data/app.db');
const publicUrl = String(
  process.env.PUBLIC_URL || `http://localhost:${port}`,
).replace(/\/+$/, '');

let db;
try {
  db = initDatabase({
    dbPath,
    participantsPath: path.join(ROOT_DIR, 'config', 'participants.json'),
    logger: console,
  });
} catch (error) {
  console.error(`No se pudo iniciar la base de datos: ${error.message}`);
  process.exit(1);
}

const app = createApp({
  db,
  adminPassword: process.env.ADMIN_PASSWORD,
  sessionSecret: process.env.SESSION_SECRET,
  publicUrl,
  exclusionsPath: path.join(ROOT_DIR, 'config', 'exclusions.json'),
  participantsPath: path.join(ROOT_DIR, 'config', 'participants.json'),
  backupDir: path.join(path.dirname(dbPath), 'backups'),
});

const server = app.listen(port, () => {
  console.log(`Intercambio disponible en ${publicUrl}`);
  console.log(`SQLite: ${dbPath}`);
  console.log(`WhatsApp: ${provider === 'none' ? 'enlaces wa.me' : provider}`);
  if (!process.env.PUBLIC_URL) {
    console.warn(
      'Aviso: PUBLIC_URL no está definida. En producción define la URL pública exacta.',
    );
  }
});

function shutdown(signal) {
  console.log(`Cerrando (${signal})...`);
  server.close(() => {
    try {
      db.close();
    } catch (error) {
      // La base de datos ya pudo haberse cerrado.
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
