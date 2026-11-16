'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createEnv,
  loginAdmin,
  claim,
  spin,
  startDraw,
  participantByIndex,
  count,
} = require('./helpers');

function names(size, prefix = 'Persona') {
  return Array.from({ length: size }, (_, index) => `${prefix} ${index + 1}`);
}

test('51. /admin/integrity devuelve ok:true para 3, 7, 12, 30 y 100 participantes', async (t) => {
  for (const size of [3, 7, 12, 30, 100]) {
    const env = createEnv({ participants: names(size) });
    t.after(() => env.cleanup());
    const { agent: adminAgent } = await loginAdmin(env);
    assert.equal((await startDraw(env, adminAgent)).status, 200, `tamaño ${size}`);
    const response = await adminAgent.get('/admin/integrity');
    assert.equal(response.status, 200, `tamaño ${size}`);
    assert.equal(response.body.ok, true, `tamaño ${size}`);
    assert.equal(response.body.total, size);
    assert.deepEqual(response.body.checks, {
      planCompleto: true,
      sinAutoasignacion: true,
      sinDuplicados: true,
      cicloCerrado: true,
      assignmentsCoincidenConPlan: true,
    });
  }
});

test('52. Un draw_plan corrupto hace que /admin/integrity devuelva ok:false y registre integrity-failed', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.equal((await adminAgent.get('/admin/integrity')).body.ok, true);

  env.db.exec('DROP TRIGGER IF EXISTS trg_draw_plan_no_delete_started');
  env.db.prepare('DELETE FROM draw_plan WHERE giver_id = ?').run(participantByIndex(env, 0).id);

  const response = await adminAgent.get('/admin/integrity');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.checks.planCompleto, false);
  assert.equal(JSON.stringify(response.body).includes('Ana'), false);
  assert.equal(
    env.db
      .prepare("SELECT COUNT(*) AS total FROM admin_log WHERE action = 'integrity-failed'")
      .get().total,
    1,
  );
});

test('53. integrity, progress y participants no contienen receptores ni ids de receptores', async (t) => {
  const previous = process.env.ADMIN_SHOW_RECEIVER_LIST;
  process.env.ADMIN_SHOW_RECEIVER_LIST = 'false';
  t.after(() => {
    if (previous === undefined) delete process.env.ADMIN_SHOW_RECEIVER_LIST;
    else process.env.ADMIN_SHOW_RECEIVER_LIST = previous;
  });

  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const participant = participantByIndex(env, 0);
  const participantAgent = env.agent();
  assert.equal((await claim(env, participantAgent, participant.id, participant.claim_code)).status, 200);
  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.equal((await spin(env, participantAgent)).status, 200);

  const integrity = await adminAgent.get('/admin/integrity');
  const progress = await adminAgent.get('/admin/progress');
  const participants = await adminAgent.get('/admin/participants');

  assert.equal(integrity.status, 200);
  assert.equal(progress.status, 200);
  assert.equal(participants.status, 200);

  for (const response of [integrity, progress, participants]) {
    const text = JSON.stringify(response.body);
    assert.equal(/receiver/i.test(text), false);
    assert.equal(/receptor/i.test(text), false);
  }
  for (const item of progress.body.pending) {
    assert.deepEqual(Object.keys(item).sort(), ['name', 'unclaimed']);
  }
  for (const row of participants.body) {
    assert.equal('receiverId' in row, false);
    assert.equal('receiver_id' in row, false);
    assert.equal('receiverName' in row, false);
  }
});

test('54. /admin/integrity sin sesión responde 401', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla'] });
  t.after(() => env.cleanup());
  assert.equal((await env.request().get('/admin/integrity')).status, 401);
  assert.equal((await env.request().get('/admin/progress')).status, 401);
});

test('55. Tras 30 giros hay 30 receptores distintos, sin repetidos ni autoasignaciones', async (t) => {
  const env = createEnv();
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const participants = env.db.prepare('SELECT * FROM participants ORDER BY id').all();
  const agents = participants.map(() => env.agent());

  const claims = await Promise.all(
    participants.map((participant, index) =>
      claim(env, agents[index], participant.id, participant.claim_code),
    ),
  );
  assert.deepEqual(claims.map((response) => response.status), Array(30).fill(200));
  assert.equal((await startDraw(env, adminAgent)).status, 200);
  const spins = await Promise.all(agents.map((agent) => spin(env, agent)));
  assert.deepEqual(spins.map((response) => response.status), Array(30).fill(200));

  const assignments = env.db
    .prepare('SELECT giver_id, receiver_id FROM assignments')
    .all();
  assert.equal(assignments.length, 30);
  assert.equal(new Set(assignments.map((row) => row.receiver_id)).size, 30);
  assert.equal(new Set(assignments.map((row) => row.giver_id)).size, 30);
  for (const row of assignments) assert.notEqual(row.giver_id, row.receiver_id);
  assert.equal((await adminAgent.get('/admin/integrity')).body.ok, true);
});

test('56. /admin/progress ordena alfabéticamente y marca Sin reclamar en la lista pendiente', async (t) => {
  const env = createEnv({ participants: ['Zoe', 'Ana', 'Luis', 'Beto'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);

  const zoe = env.db.prepare("SELECT * FROM participants WHERE name = 'Zoe'").get();
  const ana = env.db.prepare("SELECT * FROM participants WHERE name = 'Ana'").get();
  const zoeAgent = env.agent();
  const anaAgent = env.agent();
  assert.equal((await claim(env, zoeAgent, zoe.id, zoe.claim_code)).status, 200);
  assert.equal((await claim(env, anaAgent, ana.id, ana.claim_code)).status, 200);
  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.equal((await spin(env, zoeAgent)).status, 200);

  const progress = await adminAgent.get('/admin/progress');
  assert.equal(progress.status, 200);
  assert.equal(progress.body.total, 4);
  assert.equal(progress.body.spunCount, 1);
  assert.deepEqual(progress.body.spunNames, ['Zoe']);
  assert.deepEqual(
    progress.body.pending.map((item) => item.name),
    ['Ana', 'Beto', 'Luis'],
  );
  assert.deepEqual(
    progress.body.pending.map((item) => [item.name, item.unclaimed]),
    [
      ['Ana', false],
      ['Beto', true],
      ['Luis', true],
    ],
  );
  assert.deepEqual(progress.body.unclaimedPendingNames, ['Beto', 'Luis']);
  assert.equal(progress.body.giftsAssigned, 1);
  assert.equal(progress.body.giftsPending, 3);
  assert.equal(count(env, 'assignments'), 1);

  const html = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'admin.html'),
    'utf8',
  );
  const adminJs = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'admin.js'),
    'utf8',
  );
  assert.match(adminJs, /Sin reclamar/);
  assert.match(
    html,
    /Para que todos reciban regalo, todos deben girar\. Quien no gire dejará a\s+alguien sin regalo\./,
  );
  assert.match(
    html,
    /Esta persona aún no entra\. Quien le toque regalarle quedará sin regalo si\s+nunca gira\./,
  );
});
