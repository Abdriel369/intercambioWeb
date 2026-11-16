'use strict';

const fs = require('node:fs');

function readHasExclusions(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) && parsed.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Verifica el sorteo sin devolver nombres, ids ni parejas.
 * Las comprobaciones son deliberadamente genéricas.
 */
function checkIntegrity(db, options = {}) {
  const skipCycle = Boolean(options.skipCycle);
  const participants = db.prepare('SELECT id FROM participants').all();
  const plan = db.prepare('SELECT giver_id, receiver_id FROM draw_plan').all();
  const assignments = db.prepare('SELECT giver_id, receiver_id FROM assignments').all();
  const total = participants.length;
  const participantIds = new Set(participants.map((row) => row.id));

  const givers = new Set();
  const receivers = new Set();
  let planRowsValid = plan.length === total && total > 0;
  let sinAutoasignacion = true;

  for (const pair of plan) {
    if (!participantIds.has(pair.giver_id) || !participantIds.has(pair.receiver_id)) {
      planRowsValid = false;
    }
    if (givers.has(pair.giver_id) || receivers.has(pair.receiver_id)) {
      planRowsValid = false;
    }
    givers.add(pair.giver_id);
    receivers.add(pair.receiver_id);
    if (pair.giver_id === pair.receiver_id) sinAutoasignacion = false;
  }

  const planCompleto =
    planRowsValid &&
    plan.length === total &&
    givers.size === total &&
    receivers.size === total;

  const sinDuplicados =
    givers.size === plan.length && receivers.size === plan.length;

  let cicloCerrado = true;
  if (!skipCycle) {
    cicloCerrado = planCompleto && sinAutoasignacion && sinDuplicados;
    if (cicloCerrado) {
      const map = new Map(plan.map((pair) => [pair.giver_id, pair.receiver_id]));
      const start = participants[0].id;
      let current = start;
      const visited = new Set();
      for (let index = 0; index < total; index += 1) {
        if (visited.has(current) || !map.has(current)) {
          cicloCerrado = false;
          break;
        }
        visited.add(current);
        current = map.get(current);
      }
      if (visited.size !== total || current !== start) cicloCerrado = false;
    }
  }

  const planByGiver = new Map(plan.map((pair) => [pair.giver_id, pair.receiver_id]));
  const assignmentGivers = new Set(assignments.map((pair) => pair.giver_id));
  const assignmentsCoincidenConPlan =
    assignments.every((pair) => planByGiver.get(pair.giver_id) === pair.receiver_id) &&
    assignmentGivers.size === assignments.length &&
    assignments.length === assignmentGivers.size;

  const checks = {
    planCompleto: Boolean(planCompleto),
    sinAutoasignacion: Boolean(sinAutoasignacion),
    sinDuplicados: Boolean(sinDuplicados),
    cicloCerrado: Boolean(cicloCerrado),
    assignmentsCoincidenConPlan: Boolean(assignmentsCoincidenConPlan),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    total,
    checks,
  };
}

module.exports = {
  checkIntegrity,
  readHasExclusions,
};
