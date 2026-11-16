'use strict';

const { nameKey } = require('./db');

const INVALID_PHONE_MESSAGE =
  'Teléfono inválido. Usa 10 dígitos (México), +52 y 10 dígitos, o un número internacional de 11 a 15 dígitos.';

/**
 * Normaliza teléfonos:
 * - 10 dígitos => 52 + 10 dígitos.
 * - 52 + 10 dígitos => se conserva.
 * - Cualquier otro país: 11 a 15 dígitos.
 * Los números que empiezan con 52 deben tener exactamente 12 dígitos.
 */
function normalizePhone(input) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return { ok: false, error: INVALID_PHONE_MESSAGE };
  }

  const raw = String(input).trim();
  if (!raw) {
    return { ok: false, error: 'Escribe un número de teléfono.' };
  }

  if (!/^\+?[0-9\s().-]+$/.test(raw)) {
    return { ok: false, error: INVALID_PHONE_MESSAGE };
  }

  const plusCount = (raw.match(/\+/g) || []).length;
  if (plusCount > 1 || (plusCount === 1 && !raw.startsWith('+'))) {
    return { ok: false, error: INVALID_PHONE_MESSAGE };
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    return { ok: false, error: INVALID_PHONE_MESSAGE };
  }

  if (digits.length === 10) {
    return { ok: true, phone: `52${digits}` };
  }

  // Formato mexicano antiguo con prefijo 1: 521 + 10 dígitos.
  if (/^521\d{10}$/.test(digits)) {
    return { ok: true, phone: `52${digits.slice(3)}` };
  }

  if (digits.startsWith('52')) {
    if (digits.length === 12) {
      return { ok: true, phone: digits };
    }
    return {
      ok: false,
      error:
        'Para México el número debe ser 52 + 10 dígitos (12 dígitos en total).',
    };
  }

  if (digits.length >= 11 && digits.length <= 15) {
    return { ok: true, phone: digits };
  }

  return { ok: false, error: INVALID_PHONE_MESSAGE };
}

function whatsappDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function renderMessage(template, values) {
  let result = String(template);
  const safe = {
    nombre: values.nombre || '',
    url: values.url || '',
    codigo: values.codigo || '',
  };
  for (const key of Object.keys(safe)) {
    result = result.split(`{${key}}`).join(safe[key]);
  }
  return result;
}

function buildWhatsAppLink(phone, text) {
  const digits = whatsappDigits(phone);
  if (!/^\d{11,15}$/.test(digits)) {
    throw new Error('El teléfono no tiene un formato válido para WhatsApp.');
  }
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function cleanCell(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim();
}

function parseImportText(text, participants) {
  if (typeof text !== 'string') {
    return { matches: [], notFound: [], invalid: [], counts: { matches: 0, notFound: 0, invalid: 0 } };
  }

  const byName = new Map(participants.map((participant) => [nameKey(participant.name), participant]));
  const seenIds = new Set();
  const matches = [];
  const notFound = [];
  const invalid = [];

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((rawLine, index) => {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line) return;
    const lineNumber = index + 1;

    const tabIndex = line.indexOf('\t');
    const commaIndex = line.lastIndexOf(',');
    let nameCell;
    let phoneCell;

    if (tabIndex >= 0) {
      nameCell = line.slice(0, tabIndex);
      phoneCell = line.slice(tabIndex + 1);
    } else if (commaIndex >= 0) {
      nameCell = line.slice(0, commaIndex);
      phoneCell = line.slice(commaIndex + 1);
    } else {
      invalid.push({
        line: lineNumber,
        name: line,
        reason: 'Falta el teléfono. Usa "Nombre, Teléfono" o "Nombre<TAB>Teléfono".',
      });
      return;
    }

    const name = cleanCell(nameCell);
    const rawPhone = cleanCell(phoneCell);
    if (!name) {
      invalid.push({ line: lineNumber, name: '', reason: 'Falta el nombre.' });
      return;
    }

    const normalized = normalizePhone(rawPhone);
    if (!normalized.ok) {
      invalid.push({
        line: lineNumber,
        name,
        phone: rawPhone,
        reason: normalized.error,
      });
      return;
    }

    const participant = byName.get(nameKey(name));
    if (!participant) {
      notFound.push({ line: lineNumber, name });
      return;
    }

    if (seenIds.has(participant.id)) {
      invalid.push({
        line: lineNumber,
        name,
        phone: rawPhone,
        reason: 'Ese nombre aparece más de una vez en el texto.',
      });
      return;
    }

    seenIds.add(participant.id);
    matches.push({
      id: participant.id,
      name: participant.name,
      phone: normalized.phone,
    });
  });

  return {
    matches,
    notFound,
    invalid,
    counts: {
      matches: matches.length,
      notFound: notFound.length,
      invalid: invalid.length,
    },
  };
}

module.exports = {
  INVALID_PHONE_MESSAGE,
  normalizePhone,
  whatsappDigits,
  renderMessage,
  buildWhatsAppLink,
  parseImportText,
};
