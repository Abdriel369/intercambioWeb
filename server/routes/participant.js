'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
  hashToken,
  nowIso,
  addAdminLog,
} = require('../db');
const {
  participantTokenFromRequest,
  setParticipantCookie,
  clearParticipantCookie,
  claimCodeMatches,
} = require('../auth');

const CODE_REQUIRED_MESSAGE = 'No se pudo verificar el acceso.';
const LOCK_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const REQUEST_COOLDOWN_MS = 5 * 60 * 1000;

function createParticipantRouter(db, options = {}) {
  const router = express.Router();
  const sessionSecret = options.sessionSecret;
  if (!sessionSecret) throw new Error('SESSION_SECRET es obligatoria.');

  const claimLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Espera un momento.' },
  });

  const spinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Espera un momento.' },
  });

  const codeRequestLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Espera unos minutos.' },
  });

  function participantFromRequest(req) {
    const token = participantTokenFromRequest(req, sessionSecret);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db
      .prepare(
        'SELECT id, name, token_hash, claimed_at FROM participants WHERE token_hash = ?',
      )
      .get(hashToken(token));
  }

  function requireParticipant(req, res, next) {
    const participant = participantFromRequest(req);
    if (!participant) {
      clearParticipantCookie(res);
      return res.status(401).json({ error: 'Sesión no válida.' });
    }
    req.participant = participant;
    return next();
  }

  function immediateTransaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackError) {
        // La transacción ya pudo haber sido cerrada por SQLite.
      }
      throw error;
    }
  }

  router.get('/participants/available', (req, res) => {
    const participants = db
      .prepare(
        'SELECT id, name FROM participants WHERE token_hash IS NULL ORDER BY id',
      )
      .all();
    return res.json({ participants });
  });

  router.post('/request-code', codeRequestLimiter, (req, res, next) => {
    try {
      const participantId = Number(req.body && req.body.participantId);
      if (!Number.isInteger(participantId) || participantId <= 0) {
        return res.status(400).json({ error: 'Solicitud no válida.' });
      }

      const result = immediateTransaction(() => {
        const participant = db
          .prepare(
            'SELECT id, token_hash, code_requested_at FROM participants WHERE id = ?',
          )
          .get(participantId);
        if (!participant) {
          return { status: 404, body: { error: 'Participante no encontrado.' } };
        }
        if (participant.token_hash) {
          return {
            status: 409,
            body: { error: 'Ese nombre ya fue reclamado.' },
          };
        }
        if (participant.code_requested_at) {
          return {
            status: 200,
            body: {
              ok: true,
              alreadyRequested: true,
              requestedAt: participant.code_requested_at,
            },
          };
        }

        const recent = db
          .prepare(
            `SELECT created_at FROM admin_log
             WHERE participant_id = ? AND action = 'code_requested'
             ORDER BY id DESC LIMIT 1`,
          )
          .get(participantId);
        if (
          recent &&
          Date.now() - new Date(recent.created_at).getTime() < REQUEST_COOLDOWN_MS
        ) {
          return {
            status: 429,
            body: {
              error: 'Ya solicitaste tu código hace poco. Espera unos minutos.',
            },
          };
        }

        const requestedAt = nowIso();
        db.prepare(
          'UPDATE participants SET code_requested_at = ? WHERE id = ?',
        ).run(requestedAt, participantId);
        addAdminLog(db, 'code_requested', participantId);
        return {
          status: 200,
          body: { ok: true, alreadyRequested: false, requestedAt },
        };
      });

      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/claim', claimLimiter, (req, res, next) => {
    try {
      const { participantId, claimCode } = req.body || {};
      if (!Number.isInteger(participantId) || participantId <= 0) {
        return res.status(400).json({ error: 'Solicitud no válida.' });
      }
      if (typeof claimCode !== 'string' || claimCode.length === 0 || claimCode.length > 32) {
        return res.status(400).json({ error: 'Escribe el código de acceso.' });
      }

      const result = immediateTransaction(() => {
        const participant = db
          .prepare(
            'SELECT id, name, claim_code, token_hash, failed_attempts, locked_until FROM participants WHERE id = ?',
          )
          .get(participantId);

        if (!participant) {
          return { status: 403, body: { error: CODE_REQUIRED_MESSAGE } };
        }

        if (participant.token_hash) {
          return {
            status: 409,
            body: { error: 'Este nombre ya fue reclamado. Pide ayuda al administrador.' },
          };
        }

        const now = Date.now();
        if (participant.locked_until) {
          const lockedUntil = new Date(participant.locked_until).getTime();
          if (Number.isFinite(lockedUntil) && lockedUntil > now) {
            return {
              status: 429,
              body: {
                error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.',
              },
            };
          }
          db.prepare(
            'UPDATE participants SET failed_attempts = 0, locked_until = NULL WHERE id = ?',
          ).run(participant.id);
          participant.failed_attempts = 0;
          participant.locked_until = null;
        }

        if (!claimCodeMatches(participant.claim_code, claimCode)) {
          const attempts = participant.failed_attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            const lockedUntil = new Date(now + LOCK_MINUTES * 60 * 1000).toISOString();
            db.prepare(
              'UPDATE participants SET failed_attempts = ?, locked_until = ? WHERE id = ?',
            ).run(attempts, lockedUntil, participant.id);
            addAdminLog(db, 'claim_locked', participant.id);
            return {
              status: 429,
              body: {
                error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.',
              },
            };
          }

          db.prepare(
            'UPDATE participants SET failed_attempts = ? WHERE id = ?',
          ).run(attempts, participant.id);
          addAdminLog(db, 'claim_failed', participant.id);
          return { status: 403, body: { error: CODE_REQUIRED_MESSAGE } };
        }

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);
        const claimedAt = nowIso();
        const update = db
          .prepare(
            'UPDATE participants SET token_hash = ?, claimed_at = ? WHERE id = ? AND token_hash IS NULL',
          )
          .run(tokenHash, claimedAt, participant.id);

        if (update.changes !== 1) {
          return {
            status: 409,
            body: { error: 'Este nombre ya fue reclamado. Pide ayuda al administrador.' },
          };
        }

        db.prepare(
          `UPDATE participants
           SET failed_attempts = 0, locked_until = NULL, code_requested_at = NULL
           WHERE id = ?`,
        ).run(participant.id);
        addAdminLog(db, 'claim_success', participant.id);

        return {
          status: 200,
          body: { ok: true, name: participant.name },
          token,
        };
      });

      if (result.token) {
        setParticipantCookie(res, result.token, sessionSecret);
      }
      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me', requireParticipant, (req, res) => {
    const settings = db
      .prepare('SELECT draw_started FROM settings WHERE id = 1')
      .get();
    const assignment = db
      .prepare(
        `SELECT a.id, receiver.name AS receiver_name
         FROM assignments a
         JOIN participants receiver ON receiver.id = a.receiver_id
         WHERE a.giver_id = ?`,
      )
      .get(req.participant.id);

    const payload = {
      name: req.participant.name,
      drawStarted: Boolean(settings.draw_started),
      hasSpun: Boolean(assignment),
    };
    if (assignment) payload.receiverName = assignment.receiver_name;
    return res.json(payload);
  });

  router.get('/wheel-names', requireParticipant, (req, res) => {
    const names = db
      .prepare('SELECT name FROM participants ORDER BY id')
      .all()
      .map((row) => row.name);
    return res.json({ names });
  });

  router.post('/spin', spinLimiter, requireParticipant, (req, res, next) => {
    try {
      const result = immediateTransaction(() => {
        const settings = db
          .prepare('SELECT draw_started FROM settings WHERE id = 1')
          .get();
        if (!settings.draw_started) {
          return { status: 403, body: { error: 'El sorteo todavía no comienza.' } };
        }

        const existing = db
          .prepare(
            `SELECT a.id, receiver.name AS receiver_name
             FROM assignments a
             JOIN participants receiver ON receiver.id = a.receiver_id
             WHERE a.giver_id = ?`,
          )
          .get(req.participant.id);
        if (existing) {
          return {
            status: 200,
            body: { receiverName: existing.receiver_name, alreadySpun: true },
          };
        }

        const plan = db
          .prepare('SELECT receiver_id FROM draw_plan WHERE giver_id = ?')
          .get(req.participant.id);
        if (!plan) {
          return {
            status: 409,
            body: { error: 'El sorteo no está disponible. Avisa al administrador.' },
          };
        }

        const genericSpinError =
          'No se pudo completar el giro. Avisa al administrador.';
        if (plan.receiver_id === req.participant.id) {
          return { status: 409, body: { error: genericSpinError } };
        }
        const receiverAlreadyAssigned = db
          .prepare('SELECT 1 FROM assignments WHERE receiver_id = ?')
          .get(plan.receiver_id);
        if (receiverAlreadyAssigned) {
          return { status: 409, body: { error: genericSpinError } };
        }

        db.prepare(
          'INSERT INTO assignments (giver_id, receiver_id, created_at) VALUES (?, ?, ?)',
        ).run(req.participant.id, plan.receiver_id, nowIso());

        const receiver = db
          .prepare('SELECT name FROM participants WHERE id = ?')
          .get(plan.receiver_id);
        if (!receiver) {
          throw new Error('El receptor del sorteo no existe.');
        }

        return {
          status: 200,
          body: {
            receiverName: receiver.name,
            alreadySpun: false,
          },
        };
      });

      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createParticipantRouter };
