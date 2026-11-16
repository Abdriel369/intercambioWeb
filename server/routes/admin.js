'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const {
  addAdminLog,
  getAppConfig,
  setAppConfig,
  DEFAULT_MESSAGE_TEMPLATE,
  nowIso,
  generateUniqueCode,
  insertParticipants,
  readParticipantsConfig,
  withMaintenanceAuthorization,
  createBackup,
  backupTimestamp,
  nameKey,
} = require('../db');
const {
  loadExclusions,
  generateDrawPlan,
  DrawGenerationError,
} = require('../draw');
const {
  normalizePhone,
  parseImportText,
  renderMessage,
} = require('../phone');
const { getProvider, isAutomaticEnabled, sendMessage } = require('../whatsapp');
const { verifyAdminPassword } = require('../auth');
const { checkIntegrity, readHasExclusions } = require('../integrity');

const MAX_TEMPLATE_LENGTH = 1200;
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const LOGIN_RETRY_SECONDS = 10 * 60;
const ADD_DELETE_LOCKED_MESSAGE =
  'El sorteo ya inició. Para agregar o quitar participantes hay que reiniciarlo antes';

function parseParticipantId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 60) return null;
  if (/[\r\n\t]/.test(name)) return null;
  return name;
}

function findNameDuplicate(db, name, excludeId = null) {
  const key = nameKey(name);
  return db
    .prepare('SELECT id, name FROM participants')
    .all()
    .find(
      (participant) =>
        participant.id !== excludeId && nameKey(participant.name) === key,
    );
}

function serializeAdminParticipant(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    claimCode: row.claim_code,
    codeRequestedAt: row.code_requested_at,
    codeSentAt: row.code_sent_at,
    claimed: Boolean(row.claimed),
    hasSpun: Boolean(row.has_spun),
  };
}

function createAdminRouter(options) {
  const {
    db,
    auth,
    exclusionsPath,
    participantsPath,
    backupDir,
    publicUrl,
    adminPassword,
  } = options;
  const router = express.Router();
  const previews = new Map();
  let lastIntegrityOk = null;

  function prunePreviews() {
    const now = Date.now();
    for (const [token, preview] of previews) {
      if (now - preview.createdAt > PREVIEW_TTL_MS) previews.delete(token);
    }
  }

  function currentTemplate() {
    return getAppConfig(db, 'message_template', DEFAULT_MESSAGE_TEMPLATE);
  }

  function participantRows() {
    return db
      .prepare(
        `SELECT p.id, p.name, p.phone, p.claim_code, p.code_requested_at,
                p.code_sent_at, p.claimed_at,
                CASE WHEN p.token_hash IS NULL THEN 0 ELSE 1 END AS claimed,
                CASE WHEN EXISTS (
                  SELECT 1 FROM assignments a WHERE a.giver_id = p.id
                ) THEN 1 ELSE 0 END AS has_spun
         FROM participants p
         ORDER BY
           CASE WHEN p.code_requested_at IS NULL THEN 1 ELSE 0 END,
           p.code_requested_at DESC,
           p.id`,
      )
      .all();
  }

  function isDrawStarted() {
    return Boolean(
      db.prepare('SELECT draw_started FROM settings WHERE id = 1').get().draw_started,
    );
  }

  router.post('/login', (req, res) => {
    const status = auth.loginStatus(req.ip);
    if (!status.allowed) {
      res.set('Retry-After', String(Math.ceil(status.retryAfterMs / 1000)));
      return res.status(429).json({
        error: 'Demasiados intentos. Intenta de nuevo más tarde.',
      });
    }

    const password = req.body && req.body.password;
    if (typeof password !== 'string' || password.length === 0) {
      auth.recordLoginFailure(req.ip);
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    if (!verifyAdminPassword(password, adminPassword || '')) {
      const failure = auth.recordLoginFailure(req.ip);
      addAdminLog(db, 'admin_login_failed');
      if (failure.blockedUntil) {
        res.set('Retry-After', String(LOGIN_RETRY_SECONDS));
        return res.status(429).json({
          error: 'Demasiados intentos. Intenta de nuevo más tarde.',
        });
      }
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    auth.clearLoginFailures(req.ip);
    auth.issueAdminSession(req, res);
    addAdminLog(db, 'admin_login');
    return res.json({ ok: true });
  });

  router.post('/logout', auth.requireAdmin, (req, res) => {
    auth.logoutAdmin(req, res);
    addAdminLog(db, 'admin_logout');
    return res.json({ ok: true });
  });

  router.use(auth.requireAdmin);

  router.get('/participants', (req, res) => {
    const participants = participantRows().map(serializeAdminParticipant);
    return res.json(participants);
  });

  router.get('/stats', (req, res) => {
    const settings = db
      .prepare(
        'SELECT draw_started, draw_started_at, maintenance_mode FROM settings WHERE id = 1',
      )
      .get();
    const total = db.prepare('SELECT COUNT(*) AS total FROM participants').get().total;
    const claimed = db
      .prepare('SELECT COUNT(*) AS total FROM participants WHERE token_hash IS NOT NULL')
      .get().total;
    const withPhone = db
      .prepare(
        "SELECT COUNT(*) AS total FROM participants WHERE phone IS NOT NULL AND phone <> ''",
      )
      .get().total;
    const codesSent = db
      .prepare('SELECT COUNT(*) AS total FROM participants WHERE code_sent_at IS NOT NULL')
      .get().total;
    const pendingRequests = db
      .prepare(
        'SELECT COUNT(*) AS total FROM participants WHERE code_requested_at IS NOT NULL',
      )
      .get().total;
    const spun = db.prepare('SELECT COUNT(*) AS total FROM assignments').get().total;

    return res.json({
      total,
      withPhone,
      codesSent,
      claimed,
      spun,
      pendingRequests,
      drawStarted: Boolean(settings.draw_started),
      drawStartedAt: settings.draw_started_at,
      maintenanceMode: Boolean(settings.maintenance_mode),
    });
  });

  router.get('/progress', (req, res) => {
    if (!isDrawStarted()) {
      return res.status(409).json({ error: 'El sorteo todavía no comienza.' });
    }

    const collator = new Intl.Collator('es', {
      sensitivity: 'base',
      numeric: true,
    });
    const participants = db
      .prepare(
        `SELECT p.name,
                CASE WHEN p.token_hash IS NULL THEN 0 ELSE 1 END AS claimed,
                CASE WHEN EXISTS (
                  SELECT 1 FROM assignments a WHERE a.giver_id = p.id
                ) THEN 1 ELSE 0 END AS has_spun
         FROM participants p`,
      )
      .all()
      .sort((a, b) => collator.compare(a.name, b.name));
    const total = participants.length;
    const spunNames = participants
      .filter((participant) => participant.has_spun)
      .map((participant) => participant.name);
    const pending = participants
      .filter((participant) => !participant.has_spun)
      .map((participant) => ({
        name: participant.name,
        unclaimed: !participant.claimed,
      }));
    const giftsAssigned = db
      .prepare('SELECT COUNT(*) AS total FROM assignments')
      .get().total;

    return res.json({
      drawStarted: true,
      total,
      spun: spunNames.length,
      spunCount: spunNames.length,
      spunNames,
      pendingCount: pending.length,
      pending,
      pendingNames: pending.map((participant) => participant.name),
      unclaimedPendingNames: pending
        .filter((participant) => participant.unclaimed)
        .map((participant) => participant.name),
      giftsAssigned,
      giftsPending: Math.max(0, total - giftsAssigned),
    });
  });

  router.get('/integrity', (req, res) => {
    if (!isDrawStarted()) {
      return res.status(409).json({ error: 'El sorteo todavía no comienza.' });
    }

    const result = checkIntegrity(db, {
      skipCycle: readHasExclusions(exclusionsPath),
    });
    if (!result.ok && lastIntegrityOk !== false) {
      addAdminLog(db, 'integrity-failed');
    }
    lastIntegrityOk = result.ok;
    return res.json(result);
  });

  router.get('/message-template', (req, res) => {
    return res.json({
      template: currentTemplate(),
      whatsappProvider: getProvider(),
      publicUrl,
    });
  });

  router.put('/message-template', (req, res) => {
    const template = req.body && req.body.template;
    if (
      typeof template !== 'string' ||
      template.trim().length === 0 ||
      template.length > MAX_TEMPLATE_LENGTH
    ) {
      return res.status(400).json({ error: 'La plantilla debe tener entre 1 y 1200 caracteres.' });
    }
    for (const placeholder of ['{nombre}', '{url}', '{codigo}']) {
      if (!template.includes(placeholder)) {
        return res.status(400).json({
          error: `La plantilla debe incluir ${placeholder}.`,
        });
      }
    }
    setAppConfig(db, 'message_template', template.trim());
    addAdminLog(db, 'template_updated');
    return res.json({ ok: true, template: currentTemplate() });
  });

  router.post('/participants', (req, res, next) => {
    if (isDrawStarted()) {
      return res.status(403).json({ error: ADD_DELETE_LOCKED_MESSAGE });
    }
    const name = cleanName(req.body && req.body.name);
    if (!name) {
      return res.status(400).json({ error: 'El nombre debe tener entre 1 y 60 caracteres.' });
    }
    if (findNameDuplicate(db, name)) {
      return res.status(409).json({ error: 'Ese nombre ya existe.' });
    }
    const total = db.prepare('SELECT COUNT(*) AS total FROM participants').get().total;
    if (total >= 100) {
      return res.status(409).json({ error: 'El máximo es de 100 participantes.' });
    }

    let phone = null;
    if (req.body && req.body.phone !== undefined && req.body.phone !== null && req.body.phone !== '') {
      const normalized = normalizePhone(req.body.phone);
      if (!normalized.ok) return res.status(400).json({ error: normalized.error });
      phone = normalized.phone;
    }

    try {
      const participant = (() => {
        db.exec('BEGIN IMMEDIATE');
        try {
          if (isDrawStarted()) {
            db.exec('COMMIT');
            return null;
          }
          const claimCode = generateUniqueCode(db);
          const result = db
            .prepare(
              'INSERT INTO participants (name, phone, claim_code) VALUES (?, ?, ?)',
            )
            .run(name, phone, claimCode);
          addAdminLog(db, 'participant_added', Number(result.lastInsertRowid));
          db.exec('COMMIT');
          return {
            id: Number(result.lastInsertRowid),
            name,
            phone,
            claimCode,
          };
        } catch (error) {
          try {
            db.exec('ROLLBACK');
          } catch (rollbackError) {
            // La transacción pudo haberse cerrado.
          }
          throw error;
        }
      })();

      if (!participant) {
        return res.status(403).json({ error: ADD_DELETE_LOCKED_MESSAGE });
      }
      return res.status(201).json({ ok: true, participant });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'Ese nombre ya existe.' });
      }
      return next(error);
    }
  });

  router.put('/participants/:id/name', (req, res, next) => {
    if (isDrawStarted()) {
      return res.status(403).json({ error: 'El sorteo ya inició: no se puede renombrar.' });
    }
    const id = parseParticipantId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Participante no válido.' });
    const name = cleanName(req.body && req.body.name);
    if (!name) {
      return res.status(400).json({ error: 'El nombre debe tener entre 1 y 60 caracteres.' });
    }
    const participant = db.prepare('SELECT id, name FROM participants WHERE id = ?').get(id);
    if (!participant) return res.status(404).json({ error: 'Participante no encontrado.' });
    if (findNameDuplicate(db, name, id)) {
      return res.status(409).json({ error: 'Ese nombre ya existe.' });
    }

    try {
      db.prepare('UPDATE participants SET name = ? WHERE id = ?').run(name, id);
      addAdminLog(db, 'participant_renamed', id);
      return res.json({ ok: true, name });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'Ese nombre ya existe.' });
      }
      return next(error);
    }
  });

  router.delete('/participants/:id', (req, res, next) => {
    if (isDrawStarted()) {
      return res.status(403).json({ error: ADD_DELETE_LOCKED_MESSAGE });
    }
    const id = parseParticipantId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Participante no válido.' });
    const participant = db.prepare('SELECT id, name FROM participants WHERE id = ?').get(id);
    if (!participant) return res.status(404).json({ error: 'Participante no encontrado.' });
    const body = req.body || {};
    const confirmName =
      body.confirmName !== undefined
        ? body.confirmName
        : body.name !== undefined
          ? body.name
          : body.confirm;
    if (typeof confirmName !== 'string' || confirmName.trim() !== participant.name) {
      return res.status(400).json({
        error: 'Escribe exactamente el nombre del participante para confirmar.',
      });
    }
    const total = db.prepare('SELECT COUNT(*) AS total FROM participants').get().total;
    if (total <= 3) {
      return res.status(409).json({ error: 'Debe haber al menos 3 participantes.' });
    }

    try {
      const remove = db.transaction(() => {
        db.prepare('UPDATE admin_log SET participant_id = NULL WHERE participant_id = ?').run(id);
        db.prepare('DELETE FROM participants WHERE id = ?').run(id);
        addAdminLog(db, 'participant_deleted');
      });
      remove();
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/participants/:id/phone', (req, res) => {
    const id = parseParticipantId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Participante no válido.' });

    const participant = db.prepare('SELECT id FROM participants WHERE id = ?').get(id);
    if (!participant) return res.status(404).json({ error: 'Participante no encontrado.' });

    const normalized = normalizePhone(req.body && req.body.phone);
    if (!normalized.ok) {
      return res.status(400).json({ error: normalized.error });
    }

    db.prepare('UPDATE participants SET phone = ? WHERE id = ?').run(normalized.phone, id);
    addAdminLog(db, 'phone_updated', id);
    return res.json({ ok: true, phone: normalized.phone });
  });

  router.post('/participants/import/preview', (req, res) => {
    const text = req.body && req.body.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Pega al menos una línea para importar.' });
    }
    if (text.length > 50000) {
      return res.status(400).json({ error: 'El texto es demasiado grande.' });
    }

    const participants = db.prepare('SELECT id, name FROM participants ORDER BY id').all();
    const preview = parseImportText(text, participants);
    prunePreviews();
    const previewToken = crypto.randomBytes(24).toString('hex');
    previews.set(previewToken, {
      createdAt: Date.now(),
      adminSessionKey: req.adminSessionKey,
      matches: preview.matches,
    });

    return res.json({
      previewToken,
      matches: preview.matches,
      notFound: preview.notFound,
      invalid: preview.invalid,
      counts: preview.counts,
      expiresInSeconds: Math.floor(PREVIEW_TTL_MS / 1000),
    });
  });

  router.post('/participants/import/confirm', (req, res, next) => {
    const previewToken = req.body && req.body.previewToken;
    if (typeof previewToken !== 'string' || !previewToken) {
      return res.status(400).json({ error: 'Primero genera una vista previa.' });
    }
    prunePreviews();
    const preview = previews.get(previewToken);
    if (
      !preview ||
      preview.adminSessionKey !== req.adminSessionKey ||
      Date.now() - preview.createdAt > PREVIEW_TTL_MS
    ) {
      return res.status(400).json({ error: 'La vista previa expiró. Genera otra.' });
    }

    try {
      const update = db.prepare('UPDATE participants SET phone = ? WHERE id = ?');
      const apply = db.transaction(() => {
        let updated = 0;
        for (const match of preview.matches) {
          updated += update.run(match.phone, match.id).changes;
        }
        addAdminLog(db, 'phones_imported');
        return updated;
      });
      const updated = apply();
      previews.delete(previewToken);
      return res.json({ ok: true, updated });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/participants/:id/mark-sent', (req, res) => {
    const id = parseParticipantId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Participante no válido.' });
    const participant = db.prepare('SELECT id FROM participants WHERE id = ?').get(id);
    if (!participant) return res.status(404).json({ error: 'Participante no encontrado.' });

    const sentAt = nowIso();
    db.prepare(
      'UPDATE participants SET code_sent_at = ?, code_requested_at = NULL WHERE id = ?',
    ).run(sentAt, id);
    addAdminLog(db, 'code_marked_sent', id);
    return res.json({ ok: true, codeSentAt: sentAt });
  });

  router.post('/participants/:id/release', (req, res, next) => {
    const id = parseParticipantId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Participante no válido.' });
    const regenerateCode = req.body && req.body.regenerateCode;
    if (typeof regenerateCode !== 'boolean') {
      return res.status(400).json({ error: 'Indica si debes regenerar el código.' });
    }

    try {
      const result = db.transaction(() => {
        const participant = db
          .prepare('SELECT id, claim_code FROM participants WHERE id = ?')
          .get(id);
        if (!participant) return null;

        let claimCode = participant.claim_code;
        if (regenerateCode) {
          claimCode = generateUniqueCode(db, new Set([participant.claim_code]));
          db.prepare(
            `UPDATE participants
             SET token_hash = NULL, claimed_at = NULL, failed_attempts = 0,
                 locked_until = NULL, claim_code = ?, code_sent_at = NULL,
                 code_requested_at = NULL
             WHERE id = ?`,
          ).run(claimCode, id);
        } else {
          db.prepare(
            `UPDATE participants
             SET token_hash = NULL, claimed_at = NULL, failed_attempts = 0,
                 locked_until = NULL
             WHERE id = ?`,
          ).run(id);
        }

        addAdminLog(db, regenerateCode ? 'release_regenerated_code' : 'release', id);
        return { claimCode };
      })();

      if (!result) return res.status(404).json({ error: 'Participante no encontrado.' });
      return res.json({ ok: true, claimCode: result.claimCode });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/start', (req, res, next) => {
    if (!req.body || req.body.confirm !== 'INICIAR') {
      return res.status(400).json({
        error: 'Debes confirmar el inicio escribiendo exactamente INICIAR.',
      });
    }

    try {
      const result = (() => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const settings = db
            .prepare('SELECT draw_started FROM settings WHERE id = 1')
            .get();
          if (settings.draw_started) {
            db.exec('COMMIT');
            return { status: 409, body: { error: 'El sorteo ya fue iniciado.' } };
          }

          const participants = db
            .prepare('SELECT id, name FROM participants ORDER BY id')
            .all();
          if (participants.length < 3) {
            db.exec('ROLLBACK');
            return {
              status: 400,
              body: { error: 'Se necesitan al menos 3 participantes para iniciar.' },
            };
          }
          if (participants.length > 100) {
            db.exec('ROLLBACK');
            return { status: 400, body: { error: 'El máximo es de 100 participantes.' } };
          }

          let exclusions = [];
          try {
            exclusions = loadExclusions(exclusionsPath, participants);
          } catch (error) {
            db.exec('ROLLBACK');
            return { status: 400, body: { error: error.message } };
          }

          let plan;
          try {
            plan = generateDrawPlan(participants, exclusions);
          } catch (error) {
            db.exec('ROLLBACK');
            return {
              status: 400,
              body: {
                error:
                  error instanceof DrawGenerationError
                    ? error.message
                    : 'No se pudo generar el sorteo.',
              },
            };
          }

          const insert = db.prepare(
            'INSERT INTO draw_plan (giver_id, receiver_id) VALUES (?, ?)',
          );
          for (const pair of plan) {
            insert.run(pair.giverId, pair.receiverId);
          }

          const integrity = checkIntegrity(db, {
            skipCycle: exclusions.length > 0,
          });
          if (!integrity.ok) {
            db.exec('ROLLBACK');
            return {
              status: 500,
              body: {
                error:
                  'No se pudo verificar la integridad del sorteo. No se inició.',
              },
            };
          }

          const startedAt = nowIso();
          db.prepare(
            'UPDATE settings SET draw_started = 1, draw_started_at = ? WHERE id = 1',
          ).run(startedAt);
          addAdminLog(db, 'draw_started');
          db.exec('COMMIT');
          return {
            status: 200,
            body: { ok: true, drawStarted: true, drawStartedAt: startedAt },
          };
        } catch (error) {
          try {
            db.exec('ROLLBACK');
          } catch (rollbackError) {
            // La transacción pudo haberse cerrado previamente.
          }
          throw error;
        }
      })();

      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/reset', (req, res, next) => {
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const settings = db
          .prepare('SELECT draw_started FROM settings WHERE id = 1')
          .get();
        const assignmentCount = db
          .prepare('SELECT COUNT(*) AS total FROM assignments')
          .get().total;

        if (settings.draw_started && assignmentCount > 0) {
          db.exec('COMMIT');
          return res.status(403).json({
            error: 'Ya hay personas que giraron. El sorteo no se puede modificar.',
          });
        }

        if (settings.draw_started) {
          if (!req.body || req.body.confirm !== 'REINICIAR') {
            db.exec('ROLLBACK');
            return res.status(400).json({
              error: 'Debes confirmar escribiendo exactamente REINICIAR.',
            });
          }
          withMaintenanceAuthorization(db, () => {
            db.prepare(
              'UPDATE settings SET maintenance_mode = 1 WHERE id = 1',
            ).run();
            db.prepare('DELETE FROM assignments').run();
            db.prepare('DELETE FROM draw_plan').run();
            db.prepare(
              `UPDATE settings
               SET draw_started = 0, draw_started_at = NULL, maintenance_mode = 0
               WHERE id = 1`,
            ).run();
          });
          addAdminLog(db, 'draw_reset_without_spins');
          db.exec('COMMIT');
          return res.json({ ok: true, drawStarted: false, mode: 'draw' });
        }

        db.prepare('DELETE FROM assignments').run();
        db.prepare('DELETE FROM draw_plan').run();
        db.prepare(
          `UPDATE participants
           SET token_hash = NULL, claimed_at = NULL, failed_attempts = 0, locked_until = NULL`,
        ).run();
        addAdminLog(db, 'reset');
        db.exec('COMMIT');
        return res.json({ ok: true, drawStarted: false, mode: 'claims' });
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch (rollbackError) {
          // La transacción pudo haberse cerrado previamente.
        }
        throw error;
      }
    } catch (error) {
      return next(error);
    }
  });

  router.post('/season-reset', async (req, res, next) => {
    const blocked = auth.loginStatus(req.ip);
    if (!blocked.allowed) {
      res.set('Retry-After', String(Math.ceil(blocked.retryAfterMs / 1000)));
      return res.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
    }

    const body = req.body || {};
    if (body.confirm !== 'BORRAR TODO') {
      return res.status(400).json({ error: 'Debes escribir exactamente BORRAR TODO.' });
    }
    if (typeof body.password !== 'string' || body.password.length === 0) {
      return res.status(400).json({ error: 'Escribe la contraseña de administración.' });
    }

    if (!verifyAdminPassword(body.password, adminPassword || '')) {
      const failure = auth.recordLoginFailure(req.ip);
      addAdminLog(db, 'season_reset_denied');
      if (failure.blockedUntil) {
        res.set('Retry-After', String(LOGIN_RETRY_SECONDS));
        return res.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
      }
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    let names;
    try {
      names = readParticipantsConfig(participantsPath);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const spun = db.prepare('SELECT COUNT(*) AS total FROM assignments').get().total;
    if (spun > 0 && body.confirmActive !== 'YA GIRARON, BORRAR IGUAL') {
      return res.status(409).json({
        error: 'Ya hay personas que giraron. Escribe la confirmación adicional.',
      });
    }

    let backupPath;
    try {
      backupPath = await createBackup(db, backupDir, 'app');
    } catch (error) {
      return res.status(500).json({
        error: 'No se pudo crear el respaldo automático. No se borró nada.',
      });
    }

    const oldCodes = db
      .prepare('SELECT claim_code FROM participants')
      .all()
      .map((row) => row.claim_code);

    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const activeCount = db
          .prepare('SELECT COUNT(*) AS total FROM assignments')
          .get().total;
        if (activeCount > 0 && body.confirmActive !== 'YA GIRARON, BORRAR IGUAL') {
          db.exec('ROLLBACK');
          return res.status(409).json({
            error: 'Ya hay personas que giraron. Escribe la confirmación adicional.',
          });
        }

        withMaintenanceAuthorization(db, () => {
          db.prepare('UPDATE settings SET maintenance_mode = 1 WHERE id = 1').run();
          db.prepare('DELETE FROM assignments').run();
          db.prepare('DELETE FROM draw_plan').run();
          db.prepare('DELETE FROM admin_log').run();
          db.prepare('DELETE FROM participants').run();
          insertParticipants(db, names, { avoidCodes: new Set(oldCodes) });
          db.prepare(
            `UPDATE settings
             SET draw_started = 0, draw_started_at = NULL, maintenance_mode = 0
             WHERE id = 1`,
          ).run();
          addAdminLog(db, 'season-reset');
        });

        db.exec('COMMIT');
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch (rollbackError) {
          // La transacción pudo haberse cerrado previamente.
        }
        throw error;
      }

      auth.clearLoginFailures(req.ip);
      auth.invalidateAllSessions(res);
      return res.json({
        ok: true,
        message: 'Temporada reiniciada. Vuelve a iniciar sesión.',
        backup: path.basename(backupPath),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/backup', async (req, res, next) => {
    let tempDir = null;
    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mendiola-backup-'));
      const destination = path.join(tempDir, 'intercambio-mendiola.db');
      await db.backup(destination);
      addAdminLog(db, 'backup_downloaded');
      const filename = `intercambio-mendiola-${backupTimestamp()}.db`;
      return res.download(destination, filename, (error) => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          // Limpieza best-effort.
        }
        if (error && !res.headersSent) next(error);
      });
    } catch (error) {
      if (tempDir) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          // Limpieza best-effort.
        }
      }
      return next(error);
    }
  });

  router.get('/log', (req, res) => {
    const rows = db
      .prepare(
        `SELECT id, action, participant_id, created_at
         FROM admin_log
         ORDER BY id DESC
         LIMIT 100`,
      )
      .all();
    return res.json({
      log: rows.map((row) => ({
        id: row.id,
        action: row.action,
        participantId: row.participant_id,
        createdAt: row.created_at,
      })),
    });
  });

  router.post('/participants/:id/send-auto', async (req, res) => {
    if (!isAutomaticEnabled()) {
      return res.status(400).json({
        error: 'El envío automático está desactivado. Usa el botón de WhatsApp.',
      });
    }
    const id = parseParticipantId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Participante no válido.' });

    const participant = db
      .prepare('SELECT id, name, phone, claim_code FROM participants WHERE id = ?')
      .get(id);
    if (!participant) return res.status(404).json({ error: 'Participante no encontrado.' });
    if (!participant.phone) {
      return res.status(400).json({ error: 'Ese participante todavía no tiene teléfono.' });
    }

    const message = renderMessage(currentTemplate(), {
      nombre: participant.name,
      url: publicUrl,
      codigo: participant.claim_code,
    });

    try {
      await sendMessage(participant.phone, message, {
        nombre: participant.name,
        url: publicUrl,
        codigo: participant.claim_code,
      });
      const sentAt = nowIso();
      db.prepare(
        'UPDATE participants SET code_sent_at = ?, code_requested_at = NULL WHERE id = ?',
      ).run(sentAt, id);
      addAdminLog(db, 'code_sent_automatically', id);
      return res.json({ ok: true, codeSentAt: sentAt });
    } catch (error) {
      return res.status(502).json({
        error: 'No se pudo enviar automáticamente. Revisa la configuración de WhatsApp.',
      });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
