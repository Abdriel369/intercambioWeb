'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateDrawPlan,
  validateDrawPlan,
} = require('../server/draw');
const { normalizePhone } = require('../server/phone');
const {
  createEnv,
  claim,
  participantByIndex,
} = require('./helpers');

function makeParticipants(size) {
  return Array.from({ length: size }, (_, index) => ({
    id: index + 1,
    name: `Participante ${index + 1}`,
  }));
}

function assertValidPlan(plan, participants) {
  validateDrawPlan(plan, participants);
  assert.equal(plan.length, participants.length);
  assert.equal(new Set(plan.map((pair) => pair.giverId)).size, participants.length);
  assert.equal(new Set(plan.map((pair) => pair.receiverId)).size, participants.length);
  for (const pair of plan) assert.notEqual(pair.giverId, pair.receiverId);
}

test('1. La permutación cumple: cada giver y receiver una vez, sin autoasignación', () => {
  const participants = makeParticipants(30);
  const plan = generateDrawPlan(participants, []);
  assertValidPlan(plan, participants);
  assert.equal(plan.length, 30);
});

test('2. Tamaños 3, 7, 12, 30, 31 y 100 cumplen las reglas en muchas repeticiones', () => {
  for (const size of [3, 7, 12, 30, 31, 100]) {
    const participants = makeParticipants(size);
    const repetitions = size === 100 ? 15 : 35;
    for (let index = 0; index < repetitions; index += 1) {
      assertValidPlan(generateDrawPlan(participants, []), participants);
    }
  }
});

test('17. Normalización de teléfonos, incluido el antiguo prefijo 521', () => {
  for (const input of [
    '777 123 4567',
    '+52 (777) 123-4567',
    '527771234567',
    '5217771234567',
  ]) {
    assert.deepEqual(normalizePhone(input), { ok: true, phone: '527771234567' }, input);
  }
  assert.equal(normalizePhone('+1 (212) 555-0100').ok, true);
  assert.equal(normalizePhone('+1 (212) 555-0100').phone, '12125550100');
  assert.equal(normalizePhone('12345').ok, false);
  assert.equal(normalizePhone('52 777 123 4567 99').ok, false);
  assert.equal(normalizePhone('teléfono').ok, false);
});

test('La cookie de participante va firmada, HttpOnly y SameSite=Lax', async (t) => {
  const env = createEnv();
  t.after(() => env.cleanup());
  const participant = participantByIndex(env, 0);
  const agent = env.agent();
  const response = await claim(env, agent, participant.id, participant.claim_code);
  assert.equal(response.status, 200);
  const cookie = response.headers['set-cookie'];
  assert.ok(cookie);
  const header = Array.isArray(cookie) ? cookie.join(';') : cookie;
  assert.match(header, /mendiola_participant=[a-f0-9]{64}\.[a-f0-9]{64}/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
});
