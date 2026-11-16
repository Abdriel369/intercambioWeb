'use strict';

const fs = require('node:fs');
const { randomInt } = require('node:crypto');
const { nameKey } = require('./db');

class DrawGenerationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DrawGenerationError';
  }
}

/**
 * Mezcla de Sattolo: produce una permutación de un solo ciclo.
 * Para n >= 2, ningún elemento queda en su posición original.
 */
function sattoloShuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function resolveExclusions(participants, rawExclusions = []) {
  if (!Array.isArray(rawExclusions)) {
    throw new DrawGenerationError('config/exclusions.json debe ser un arreglo de pares.');
  }

  const byName = new Map(participants.map((p) => [nameKey(p.name), p.id]));
  const seen = new Set();
  const pairs = [];

  for (const rawPair of rawExclusions) {
    if (!Array.isArray(rawPair) || rawPair.length !== 2) {
      throw new DrawGenerationError(
        'Cada exclusión debe ser un par [Nombre A, Nombre B].',
      );
    }
    const keys = rawPair.map((name) => nameKey(String(name)));
    const firstId = byName.get(keys[0]);
    const secondId = byName.get(keys[1]);
    if (firstId === undefined || secondId === undefined) {
      throw new DrawGenerationError(
        `config/exclusions.json contiene un nombre que no existe: ${
          firstId === undefined ? rawPair[0] : rawPair[1]
        }`,
      );
    }
    if (firstId === secondId) {
      throw new DrawGenerationError('Una exclusión no puede repetir a la misma persona.');
    }
    const key = [firstId, secondId].sort((a, b) => a - b).join(':');
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push([firstId, secondId]);
    }
  }

  return pairs;
}

function validateDrawPlan(plan, participants) {
  if (!Array.isArray(plan) || !Array.isArray(participants)) {
    throw new DrawGenerationError('El plan del sorteo no es válido.');
  }
  const ids = new Set(participants.map((participant) => participant.id));
  if (plan.length !== participants.length || ids.size !== participants.length) {
    throw new DrawGenerationError('El plan del sorteo no cubre a todos los participantes.');
  }

  const givers = new Set();
  const receivers = new Set();
  for (const pair of plan) {
    if (!ids.has(pair.giverId) || !ids.has(pair.receiverId)) {
      throw new DrawGenerationError('El plan del sorteo contiene participantes desconocidos.');
    }
    if (pair.giverId === pair.receiverId) {
      throw new DrawGenerationError('El plan del sorteo contiene una autoasignación.');
    }
    if (givers.has(pair.giverId) || receivers.has(pair.receiverId)) {
      throw new DrawGenerationError('El plan del sorteo repite un participante.');
    }
    givers.add(pair.giverId);
    receivers.add(pair.receiverId);
  }

  if (givers.size !== participants.length || receivers.size !== participants.length) {
    throw new DrawGenerationError('El plan del sorteo no es una permutación completa.');
  }
  return true;
}

function generateDrawPlan(participants, exclusionPairs = [], maxAttempts = 10000) {
  if (!Array.isArray(participants) || participants.length < 3) {
    throw new DrawGenerationError('Se necesitan al menos tres participantes para sortear.');
  }
  if (participants.length > 100) {
    throw new DrawGenerationError('El máximo es de 100 participantes.');
  }

  const ids = participants.map((p) => p.id);
  if (new Set(ids).size !== ids.length) {
    throw new DrawGenerationError('Hay identificadores de participantes repetidos.');
  }

  const forbidden = new Set();
  for (const [first, second] of exclusionPairs) {
    forbidden.add(`${first}:${second}`);
    forbidden.add(`${second}:${first}`);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const receivers = sattoloShuffle(ids);
    let valid = true;
    for (let i = 0; i < ids.length; i += 1) {
      const giver = ids[i];
      const receiver = receivers[i];
      if (giver === receiver || forbidden.has(`${giver}:${receiver}`)) {
        valid = false;
        break;
      }
    }
    if (valid) {
      const plan = ids.map((giverId, index) => ({
        giverId,
        receiverId: receivers[index],
      }));
      validateDrawPlan(plan, participants);
      return plan;
    }
  }

  throw new DrawGenerationError(
    `No se pudo generar un sorteo válido tras ${maxAttempts} intentos. Revisa config/exclusions.json: las restricciones podrían ser imposibles.`,
  );
}

function loadExclusions(filePath, participants) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new DrawGenerationError('config/exclusions.json no contiene JSON válido.');
  }
  return resolveExclusions(participants, parsed);
}

module.exports = {
  DrawGenerationError,
  sattoloShuffle,
  resolveExclusions,
  generateDrawPlan,
  validateDrawPlan,
  loadExclusions,
};
