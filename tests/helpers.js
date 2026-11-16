'use strict';

process.env.NODE_ENV = 'test';
process.env.WHATSAPP_PROVIDER = process.env.WHATSAPP_PROVIDER || 'none';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { initDatabase } = require('../server/db');
const { createApp } = require('../server/app');

const ORIGIN = 'http://test.local';
const ADMIN_PASSWORD = 'clave-de-prueba-segura';
const SESSION_SECRET = 'secreto-de-sesion-de-prueba-con-mas-de-32-caracteres';
const silentLogger = { log() {}, warn() {}, error() {} };

function createEnv(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intercambio-mendiola-'));
  const participants =
    options.participants ||
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'participants.json'), 'utf8'));
  const exclusions = options.exclusions || [];
  const participantsPath = path.join(dir, 'participants.json');
  const exclusionsPath = path.join(dir, 'exclusions.json');
  const backupDir = path.join(dir, 'backups');
  const dbPath = path.join(dir, 'app.db');

  fs.writeFileSync(participantsPath, JSON.stringify(participants, null, 2));
  fs.writeFileSync(exclusionsPath, JSON.stringify(exclusions, null, 2));

  const db = initDatabase({
    dbPath,
    participantsPath,
    logger: silentLogger,
  });
  const app = createApp({
    db,
    adminPassword: options.adminPassword || ADMIN_PASSWORD,
    sessionSecret: options.sessionSecret || SESSION_SECRET,
    publicUrl: ORIGIN,
    exclusionsPath,
    participantsPath,
    backupDir,
    trustProxy: false,
  });

  return {
    dir,
    db,
    app,
    participants,
    participantsPath,
    exclusionsPath,
    backupDir,
    dbPath,
    request: () => request(app),
    agent: () => request.agent(app),
    cleanup() {
      try {
        db.close();
      } catch (error) {
        // La base ya pudo haberse cerrado.
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function loginAdmin(env, password = ADMIN_PASSWORD) {
  const agent = request.agent(env.app);
  const response = await agent
    .post('/admin/login')
    .set('Origin', ORIGIN)
    .send({ password });
  return { agent, response };
}

async function claim(env, agent, participantId, claimCode) {
  return agent
    .post('/api/claim')
    .set('Origin', ORIGIN)
    .send({ participantId, claimCode });
}

async function requestCode(env, participantId) {
  return env
    .request()
    .post('/api/request-code')
    .set('Origin', ORIGIN)
    .send({ participantId });
}

async function spin(env, agent) {
  return agent.post('/api/spin').set('Origin', ORIGIN).send({});
}

async function startDraw(env, adminAgent) {
  return adminAgent
    .post('/admin/start')
    .set('Origin', ORIGIN)
    .send({ confirm: 'INICIAR' });
}

function participantByIndex(env, index = 0) {
  return env.db.prepare('SELECT * FROM participants ORDER BY id').all()[index];
}

function settings(env) {
  return env.db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

function count(env, table) {
  return env.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
}

module.exports = {
  ORIGIN,
  ADMIN_PASSWORD,
  SESSION_SECRET,
  createEnv,
  loginAdmin,
  claim,
  requestCode,
  spin,
  startDraw,
  participantByIndex,
  settings,
  count,
};
