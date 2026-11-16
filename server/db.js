'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const DEFAULT_MESSAGE_TEMPLATE =
  'Hola {nombre} 🎄 Este es tu acceso al Intercambio. Entra a {url} , elige tu nombre y escribe este código: {codigo}. Es personal, no lo compartas.';
const MAINTENANCE_AUTHORIZATIONS = new WeakMap();

function nowIso() {
  return new Date().toISOString();
}

function generateClaimCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function nameKey(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function columnExists(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      phone TEXT NULL,
      claim_code TEXT NOT NULL,
      code_requested_at TEXT NULL,
      code_sent_at TEXT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT NULL,
      token_hash TEXT NULL,
      claimed_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS draw_plan (
      giver_id INTEGER UNIQUE NOT NULL REFERENCES participants(id),
      receiver_id INTEGER UNIQUE NOT NULL REFERENCES participants(id),
      CHECK(giver_id <> receiver_id)
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY,
      giver_id INTEGER UNIQUE NOT NULL REFERENCES participants(id),
      receiver_id INTEGER UNIQUE NOT NULL REFERENCES participants(id),
      created_at TEXT NOT NULL,
      CHECK(giver_id <> receiver_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      draw_started INTEGER NOT NULL DEFAULT 0 CHECK(draw_started IN (0, 1)),
      draw_started_at TEXT NULL,
      maintenance_mode INTEGER NOT NULL DEFAULT 0 CHECK(maintenance_mode IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS admin_log (
      id INTEGER PRIMARY KEY,
      action TEXT NOT NULL,
      participant_id INTEGER NULL REFERENCES participants(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_receiver ON assignments(receiver_id);
    CREATE INDEX IF NOT EXISTS idx_admin_log_created ON admin_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_participants_requested ON participants(code_requested_at);
  `);

  if (!columnExists(db, 'participants', 'code_requested_at')) {
    db.exec('ALTER TABLE participants ADD COLUMN code_requested_at TEXT NULL');
  }
  if (!columnExists(db, 'settings', 'maintenance_mode')) {
    db.exec(
      'ALTER TABLE settings ADD COLUMN maintenance_mode INTEGER NOT NULL DEFAULT 0',
    );
  }

  const oldTriggers = [
    'trg_draw_plan_no_update_started',
    'trg_draw_plan_no_delete_started',
    'trg_draw_plan_no_insert_started',
    'trg_assignments_no_update_started',
    'trg_assignments_no_delete_started',
    'trg_participants_no_delete',
    'trg_participants_name_locked',
    'trg_settings_no_reset',
  ];
  for (const trigger of oldTriggers) {
    db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
  }

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_participants_no_insert_started
    BEFORE INSERT ON participants
    WHEN (SELECT draw_started FROM settings WHERE id = 1) = 1
      AND (SELECT maintenance_mode FROM settings WHERE id = 1) = 0
    BEGIN
      SELECT RAISE(ABORT, 'El sorteo ya inició: no se pueden agregar participantes');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_participants_no_delete_started
    BEFORE DELETE ON participants
    WHEN (SELECT draw_started FROM settings WHERE id = 1) = 1
      AND (SELECT maintenance_mode FROM settings WHERE id = 1) = 0
    BEGIN
      SELECT RAISE(ABORT, 'El sorteo ya inició: no se pueden eliminar participantes');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_participants_name_locked
    BEFORE UPDATE OF name ON participants
    WHEN (SELECT draw_started FROM settings WHERE id = 1) = 1
      AND (SELECT maintenance_mode FROM settings WHERE id = 1) = 0
    BEGIN
      SELECT RAISE(ABORT, 'El sorteo ya inició: el nombre está congelado');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_draw_plan_no_insert_started
    BEFORE INSERT ON draw_plan
    WHEN (SELECT draw_started FROM settings WHERE id = 1) = 1
      AND (SELECT maintenance_mode FROM settings WHERE id = 1) = 0
    BEGIN
      SELECT RAISE(ABORT, 'El sorteo ya inició: draw_plan está congelado');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_draw_plan_no_update_started
    BEFORE UPDATE ON draw_plan
    WHEN (SELECT draw_started FROM settings WHERE id = 1) = 1
      AND (SELECT maintenance_mode FROM settings WHERE id = 1) = 0
    BEGIN
      SELECT RAISE(ABORT, 'El sorteo ya inició: draw_plan está congelado');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_draw_plan_no_delete_started
    BEFORE DELETE ON draw_plan
    WHEN (SELECT draw_started FROM settings WHERE id = 1) = 1
      AND (SELECT maintenance_mode FROM settings WHERE id = 1) = 0
    BEGIN
      SELECT RAISE(ABORT, 'El sorteo ya inició: draw_plan está congelado');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_assignments_no_update_started
    BEFORE UPDATE ON assignments
    WHEN (SELECT draw_started FROM settings WHERE id = 1) = 1
      AND (SELECT maintenance_mode FROM settings WHERE id = 1) = 0
    BEGIN
      SELECT RAISE(ABORT, 'El sorteo ya inició: assignments está congelado');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_assignments_no_delete_started
    BEFORE DELETE ON assignments
    WHEN (SELECT draw_started FROM settings WHERE id = 1) = 1
      AND (SELECT maintenance_mode FROM settings WHERE id = 1) = 0
    BEGIN
      SELECT RAISE(ABORT, 'El sorteo ya inició: assignments está congelado');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_settings_no_reset
    BEFORE UPDATE OF draw_started ON settings
    WHEN OLD.draw_started = 1
      AND NEW.draw_started <> 1
      AND (SELECT maintenance_mode FROM settings WHERE id = 1) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'El sorteo no se puede reiniciar sin maintenance_mode autorizado');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_settings_maintenance_guard
    BEFORE UPDATE OF maintenance_mode ON settings
    WHEN NEW.maintenance_mode = 1 AND app_authorized_maintenance() = 0
    BEGIN
      SELECT RAISE(ABORT, 'maintenance_mode solo puede activarse desde una ruta autorizada');
    END;
  `);

  db.prepare('INSERT OR IGNORE INTO settings (id, draw_started) VALUES (1, 0)').run();
  db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)').run(
    'message_template',
    DEFAULT_MESSAGE_TEMPLATE,
  );
}

function readParticipantsConfig(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`No se pudo leer el archivo de participantes: ${filePath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('config/participants.json no contiene JSON válido.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('config/participants.json debe ser un arreglo de nombres.');
  }
  if (parsed.length < 1 || parsed.length > 100) {
    throw new Error('config/participants.json debe tener entre 1 y 100 participantes.');
  }

  const names = parsed.map((name, index) => {
    if (typeof name !== 'string') {
      throw new Error(`El nombre en la posición ${index + 1} debe ser texto.`);
    }
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) {
      throw new Error(`El nombre en la posición ${index + 1} está vacío.`);
    }
    if (clean.length > 60) {
      throw new Error(`El nombre "${clean}" supera los 60 caracteres.`);
    }
    if (/[\r\n\t]/.test(clean)) {
      throw new Error(`El nombre "${clean}" contiene caracteres no permitidos.`);
    }
    return clean;
  });

  const exact = new Set();
  const normalized = new Set();
  for (const name of names) {
    if (exact.has(name)) {
      throw new Error(`Hay un nombre repetido en config/participants.json: ${name}`);
    }
    exact.add(name);
    const key = nameKey(name);
    if (normalized.has(key)) {
      throw new Error(`Hay nombres que se confunden entre sí (mayúsculas/acentos): ${name}`);
    }
    normalized.add(key);
  }

  return names;
}

function generateUniqueCode(db, extraAvoid = new Set()) {
  const used = new Set(extraAvoid);
  for (const row of db.prepare('SELECT claim_code FROM participants').all()) {
    used.add(row.claim_code);
  }
  let code = generateClaimCode();
  while (used.has(code)) code = generateClaimCode();
  return code;
}

/**
 * Inserta participantes nuevos y devuelve los registros creados.
 * No valida duplicados; los llamadores deben validar el arreglo de nombres.
 */
function insertParticipants(db, names, options = {}) {
  const avoid = new Set(options.avoidCodes || []);
  const insert = db.prepare(
    'INSERT INTO participants (name, phone, claim_code) VALUES (?, ?, ?)',
  );
  const inserted = [];
  for (const name of names) {
    const code = generateUniqueCode(db, avoid);
    avoid.add(code);
    const result = insert.run(name, options.phone || null, code);
    inserted.push({
      id: Number(result.lastInsertRowid),
      name,
      claimCode: code,
    });
  }
  return inserted;
}

function seedParticipants(db, names) {
  const count = db.prepare('SELECT COUNT(*) AS total FROM participants').get().total;
  if (count > 0) return 0;

  const run = db.transaction(() => insertParticipants(db, names));
  run();
  return names.length;
}

function initDatabase(options = {}) {
  const dbPath =
    options.dbPath || process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'app.db');
  const participantsPath =
    options.participantsPath || path.resolve(process.cwd(), 'config', 'participants.json');
  const logger = options.logger || console;

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  db.function('app_authorized_maintenance', () =>
    (MAINTENANCE_AUTHORIZATIONS.get(db) || 0) > 0 ? 1 : 0,
  );

  createSchema(db);

  // Una transacción interrumpida deja maintenance_mode a 0 de forma segura.
  db.prepare(
    'UPDATE settings SET maintenance_mode = 0 WHERE maintenance_mode = 1',
  ).run();

  const started = Boolean(
    db.prepare('SELECT draw_started FROM settings WHERE id = 1').get().draw_started,
  );
  const currentCount = db.prepare('SELECT COUNT(*) AS total FROM participants').get().total;

  if (currentCount === 0) {
    if (started) {
      throw new Error(
        'La base de datos no tiene participantes, pero el sorteo ya está iniciado. Revisa DB_PATH.',
      );
    }
    const names = readParticipantsConfig(participantsPath);
    const inserted = seedParticipants(db, names);
    logger.log?.(`[db] Sembrados ${inserted} participantes desde config/participants.json.`);
    return db;
  }

  let names = null;
  try {
    names = readParticipantsConfig(participantsPath);
  } catch (error) {
    logger.warn?.(
      '[db] No se pudo leer config/participants.json; se conserva la tabla existente.',
    );
  }

  if (names) {
    const currentNames = db
      .prepare('SELECT name FROM participants ORDER BY id')
      .all()
      .map((row) => row.name);
    const differs =
      currentNames.length !== names.length ||
      currentNames.some((name, index) => name !== names[index]);
    if (differs) {
      logger.warn?.(
        '[db] config/participants.json difiere de la tabla existente. No se resembró (los participantes existentes se conservan).',
      );
    }
  }
  if (started) {
    logger.warn?.(
      '[db] El sorteo ya inició. La configuración de participantes no puede alterar la base de datos.',
    );
  }

  return db;
}

function addAdminLog(db, action, participantId = null) {
  if (!action || typeof action !== 'string') return;
  db.prepare(
    'INSERT INTO admin_log (action, participant_id, created_at) VALUES (?, ?, ?)',
  ).run(action, participantId, nowIso());
}

function getAppConfig(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setAppConfig(db, key, value) {
  db.prepare(
    'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

function withMaintenanceAuthorization(db, fn) {
  const current = MAINTENANCE_AUTHORIZATIONS.get(db) || 0;
  MAINTENANCE_AUTHORIZATIONS.set(db, current + 1);
  try {
    return fn();
  } finally {
    if (current > 0) {
      MAINTENANCE_AUTHORIZATIONS.set(db, current);
    } else {
      MAINTENANCE_AUTHORIZATIONS.delete(db);
    }
  }
}

function backupTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function pruneBackups(backupDir, keep = 5) {
  if (!fs.existsSync(backupDir)) return;
  const files = fs
    .readdirSync(backupDir)
    .filter((file) => /^app-\d{8}-\d{6}\.db$/.test(file))
    .map((file) => ({
      file,
      path: path.join(backupDir, file),
      mtime: fs.statSync(path.join(backupDir, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const extra of files.slice(keep)) {
    try {
      fs.unlinkSync(extra.path);
    } catch (error) {
      // Un respaldo que no se puede borrar no debe impedir la operación.
    }
  }
}

async function createBackup(db, backupDir, prefix = 'app') {
  fs.mkdirSync(backupDir, { recursive: true });
  const filename = `${prefix}-${backupTimestamp()}.db`;
  const destination = path.join(backupDir, filename);
  await db.backup(destination);
  if (prefix === 'app') pruneBackups(backupDir, 5);
  return destination;
}

module.exports = {
  CODE_ALPHABET,
  DEFAULT_MESSAGE_TEMPLATE,
  createSchema,
  initDatabase,
  seedParticipants,
  insertParticipants,
  readParticipantsConfig,
  generateClaimCode,
  generateUniqueCode,
  hashToken,
  nameKey,
  nowIso,
  addAdminLog,
  getAppConfig,
  setAppConfig,
  withMaintenanceAuthorization,
  createBackup,
  pruneBackups,
  backupTimestamp,
};
