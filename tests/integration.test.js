'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  ORIGIN,
  ADMIN_PASSWORD,
  createEnv,
  loginAdmin,
  claim,
  requestCode,
  spin,
  startDraw,
  participantByIndex,
  settings,
  count,
} = require('./helpers');
const { renderMessage, buildWhatsAppLink } = require('../server/phone');

function allParticipants(env) {
  return env.db.prepare('SELECT * FROM participants ORDER BY id').all();
}

async function claimByIndex(env, index = 0) {
  const participant = participantByIndex(env, index);
  const agent = env.agent();
  const response = await claim(env, agent, participant.id, participant.claim_code);
  return { participant, agent, response };
}

async function adminPost(agent, route, body = {}) {
  return agent.post(route).set('Origin', ORIGIN).send(body);
}

async function adminPut(agent, route, body = {}) {
  return agent.put(route).set('Origin', ORIGIN).send(body);
}

async function adminDelete(agent, route, body = {}) {
  return agent.delete(route).set('Origin', ORIGIN).send(body);
}

test('3. Dos giros seguidos del mismo usuario devuelven el mismo resultado', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const { agent } = await claimByIndex(env, 0);
  assert.equal((await startDraw(env, adminAgent)).status, 200);

  const first = await spin(env, agent);
  const second = await spin(env, agent);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.receiverName, second.body.receiverName);
  assert.equal(second.body.alreadySpun, true);
  assert.equal(count(env, 'assignments'), 1);
});

test('4. Todos girando en paralelo: receptores distintos y sin autoasignación', async (t) => {
  const env = createEnv();
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const participants = allParticipants(env);
  const agents = participants.map(() => env.agent());

  const claimResponses = await Promise.all(
    participants.map((participant, index) =>
      claim(env, agents[index], participant.id, participant.claim_code),
    ),
  );
  assert.deepEqual(claimResponses.map((response) => response.status), Array(30).fill(200));
  assert.equal((await startDraw(env, adminAgent)).status, 200);

  const spinResponses = await Promise.all(agents.map((agent) => spin(env, agent)));
  assert.deepEqual(spinResponses.map((response) => response.status), Array(30).fill(200));

  const rows = env.db
    .prepare(
      `SELECT giver.name AS giver_name, receiver.name AS receiver_name
       FROM assignments a
       JOIN participants giver ON giver.id = a.giver_id
       JOIN participants receiver ON receiver.id = a.receiver_id`,
    )
    .all();
  assert.equal(rows.length, 30);
  assert.equal(new Set(rows.map((row) => row.receiver_name)).size, 30);
  for (const row of rows) assert.notEqual(row.giver_name, row.receiver_name);
});

test('5. Inicio: mínimo 3, confirmación obligatoria e idempotencia', async (t) => {
  const two = createEnv({ participants: ['Ana', 'Beto'] });
  const three = createEnv({ participants: ['Ana', 'Beto', 'Carla'] });
  t.after(() => two.cleanup());
  t.after(() => three.cleanup());

  const { agent: adminTwo } = await loginAdmin(two);
  assert.equal((await startDraw(two, adminTwo)).status, 400);
  assert.equal(settings(two).draw_started, 0);
  assert.equal(count(two, 'draw_plan'), 0);

  const { agent: adminThree } = await loginAdmin(three);
  const missing = await adminPost(adminThree, '/admin/start');
  assert.equal(missing.status, 400);
  assert.equal(settings(three).draw_started, 0);

  assert.equal((await startDraw(three, adminThree)).status, 200);
  const snapshot = three.db.prepare('SELECT * FROM draw_plan ORDER BY giver_id').all();
  assert.equal((await startDraw(three, adminThree)).status, 409);
  assert.deepEqual(
    three.db.prepare('SELECT * FROM draw_plan ORDER BY giver_id').all(),
    snapshot,
  );
});

test('6. Dos reclamos simultáneos del mismo nombre: solo uno tiene éxito', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const participant = participantByIndex(env, 0);
  const [first, second] = await Promise.all([
    claim(env, env.agent(), participant.id, participant.claim_code),
    claim(env, env.agent(), participant.id, participant.claim_code),
  ]);
  assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [200, 409]);
  const row = env.db
    .prepare('SELECT token_hash, claimed_at FROM participants WHERE id = ?')
    .get(participant.id);
  assert.ok(row.token_hash);
  assert.ok(row.claimed_at);
});

test('7. Código incorrecto y bloqueo temporal después de 5 fallos', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla'] });
  t.after(() => env.cleanup());
  const participant = participantByIndex(env, 0);
  const agent = env.agent();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await claim(env, agent, participant.id, 'INCORR');
    assert.equal(response.status, 403);
    assert.match(response.body.error, /No se pudo verificar/);
  }
  assert.equal((await claim(env, agent, participant.id, 'INCORR')).status, 429);

  const row = env.db
    .prepare('SELECT failed_attempts, locked_until FROM participants WHERE id = ?')
    .get(participant.id);
  assert.equal(row.failed_attempts, 5);
  assert.ok(new Date(row.locked_until).getTime() > Date.now());
  assert.equal(
    (await claim(env, agent, participant.id, participant.claim_code)).status,
    429,
  );
});

test('8. Liberar, regenerar código y reclamar conserva EXACTAMENTE la asignación', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const { participant, agent } = await claimByIndex(env, 0);
  assert.equal((await startDraw(env, adminAgent)).status, 200);
  const firstSpin = await spin(env, agent);
  assert.equal(firstSpin.status, 200);
  const before = env.db
    .prepare('SELECT * FROM assignments WHERE giver_id = ?')
    .get(participant.id);

  const release = await adminPost(
    adminAgent,
    `/admin/participants/${participant.id}/release`,
    { regenerateCode: true },
  );
  assert.equal(release.status, 200);
  assert.notEqual(release.body.claimCode, participant.claim_code);
  assert.equal((await agent.get('/api/me')).status, 401);
  assert.deepEqual(
    env.db.prepare('SELECT * FROM assignments WHERE giver_id = ?').get(participant.id),
    before,
  );

  const newAgent = env.agent();
  assert.equal(
    (await claim(env, newAgent, participant.id, release.body.claimCode)).status,
    200,
  );
  const secondSpin = await spin(env, newAgent);
  assert.equal(secondSpin.status, 200);
  assert.equal(secondSpin.body.receiverName, firstSpin.body.receiverName);
  assert.deepEqual(
    env.db.prepare('SELECT * FROM assignments WHERE giver_id = ?').get(participant.id),
    before,
  );
});

test('9. GET /api/wheel-names sin sesión responde 401', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla'] });
  t.after(() => env.cleanup());
  assert.equal((await env.request().get('/api/wheel-names')).status, 401);

  const { agent } = await claimByIndex(env, 0);
  const response = await agent.get('/api/wheel-names');
  assert.equal(response.status, 200);
  assert.equal(response.body.names.length, 3);
});

test('10. Triggers: congelan participantes, draw_plan y assignments después de iniciar', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const { agent } = await claimByIndex(env, 0);
  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.equal((await spin(env, agent)).status, 200);

  const plan = env.db.prepare('SELECT * FROM draw_plan LIMIT 1').get();
  const assignment = env.db.prepare('SELECT * FROM assignments LIMIT 1').get();
  const participant = participantByIndex(env, 1);
  const frozen = /congel|inició|inicio/i;

  assert.throws(
    () =>
      env.db
        .prepare(
          "INSERT INTO participants (name, claim_code) VALUES ('Nuevo', 'ABC234')",
        )
        .run(),
    frozen,
  );
  assert.throws(
    () => env.db.prepare('DELETE FROM participants WHERE id = ?').run(participant.id),
    frozen,
  );
  assert.throws(
    () =>
      env.db
        .prepare('UPDATE participants SET name = name WHERE id = ?')
        .run(participant.id),
    frozen,
  );
  assert.throws(
    () =>
      env.db
        .prepare('UPDATE draw_plan SET receiver_id = receiver_id WHERE giver_id = ?')
        .run(plan.giver_id),
    frozen,
  );
  assert.throws(() => env.db.prepare('DELETE FROM draw_plan').run(), frozen);
  assert.throws(
    () =>
      env.db
        .prepare('UPDATE assignments SET created_at = created_at WHERE id = ?')
        .run(assignment.id),
    frozen,
  );
  assert.throws(() => env.db.prepare('DELETE FROM assignments').run(), frozen);
});

test('11. Un UPDATE directo de draw_started a 0 es rechazado por trigger', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.throws(
    () => env.db.prepare('UPDATE settings SET draw_started = 0 WHERE id = 1').run(),
    /reiniciar|maintenance/i,
  );
  assert.equal(settings(env).draw_started, 1);
});

test('12. maintenance_mode no puede activarse directamente', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla'] });
  t.after(() => env.cleanup());
  assert.throws(
    () => env.db.prepare('UPDATE settings SET maintenance_mode = 1 WHERE id = 1').run(),
    /maintenance_mode|autorizada/i,
  );
  assert.equal(settings(env).maintenance_mode, 0);
});

test('13. Renombrar antes de iniciar se refleja y conserva la sesión; después da 403', async (t) => {
  const env = createEnv({
    participants: ['José Álvarez', 'María López', 'Ana Torres', 'Luis Ramos'],
  });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const { participant, agent } = await claimByIndex(env, 0);

  const renameUnclaimed = await adminPut(
    adminAgent,
    `/admin/participants/${participantByIndex(env, 1).id}/name`,
    { name: 'María Fernanda López' },
  );
  assert.equal(renameUnclaimed.status, 200);

  const available = await env.request().get('/api/participants/available');
  assert.ok(available.body.participants.some((row) => row.name === 'María Fernanda López'));
  const wheel = await agent.get('/api/wheel-names');
  assert.ok(wheel.body.names.includes('María Fernanda López'));

  const renameClaimed = await adminPut(
    adminAgent,
    `/admin/participants/${participant.id}/name`,
    { name: 'José Antonio Álvarez' },
  );
  assert.equal(renameClaimed.status, 200);
  const me = await agent.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.name, 'José Antonio Álvarez');

  const duplicate = await adminPut(
    adminAgent,
    `/admin/participants/${participantByIndex(env, 1).id}/name`,
    { name: 'JOSE ANTONIO ALVAREZ' },
  );
  assert.equal(duplicate.status, 409);

  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.equal(
    (
      await adminPut(adminAgent, `/admin/participants/${participant.id}/name`, {
        name: 'Otro Nombre',
      })
    ).status,
    403,
  );
});

test('14. Agregar y eliminar antes de iniciar; después responde 403', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const { agent } = await claimByIndex(env, 0);

  const added = await adminPost(adminAgent, '/admin/participants', {
    name: 'Daniela',
    phone: '777 123 4567',
  });
  assert.equal(added.status, 201);
  assert.match(added.body.participant.claimCode, /^[2-9A-HJ-KM-NP-Z]{6}$/);
  const available = await env.request().get('/api/participants/available');
  assert.ok(available.body.participants.some((row) => row.name === 'Daniela'));
  const wheel = await agent.get('/api/wheel-names');
  assert.ok(wheel.body.names.includes('Daniela'));

  assert.equal(
    (
      await adminPost(adminAgent, '/admin/participants', {
        name: 'daniela',
      })
    ).status,
    409,
  );

  const wrongDelete = await adminDelete(
    adminAgent,
    `/admin/participants/${added.body.participant.id}`,
    { confirmName: 'No es' },
  );
  assert.equal(wrongDelete.status, 400);
  const deleted = await adminDelete(
    adminAgent,
    `/admin/participants/${added.body.participant.id}`,
    { confirmName: 'Daniela' },
  );
  assert.equal(deleted.status, 200);

  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.equal(
    (await adminPost(adminAgent, '/admin/participants', { name: 'Extra' })).status,
    403,
  );
  assert.equal(
    (
      await adminDelete(
        adminAgent,
        `/admin/participants/${participantByIndex(env, 1).id}`,
        { confirmName: 'Beto' },
      )
    ).status,
    403,
  );
});

test('15. Reinicio sin giros funciona; con giros responde 403 sin cambios', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const { participant, agent } = await claimByIndex(env, 0);
  assert.equal((await startDraw(env, adminAgent)).status, 200);

  assert.equal((await adminPost(adminAgent, '/admin/reset', {})).status, 400);
  const reset = await adminPost(adminAgent, '/admin/reset', { confirm: 'REINICIAR' });
  assert.equal(reset.status, 200);
  assert.equal(settings(env).draw_started, 0);
  assert.equal(settings(env).maintenance_mode, 0);
  assert.equal(count(env, 'draw_plan'), 0);
  assert.ok(
    env.db.prepare('SELECT token_hash FROM participants WHERE id = ?').get(participant.id)
      .token_hash,
  );

  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.equal((await spin(env, agent)).status, 200);
  const snapshot = env.db.prepare('SELECT * FROM draw_plan ORDER BY giver_id').all();
  const blocked = await adminPost(adminAgent, '/admin/reset', { confirm: 'REINICIAR' });
  assert.equal(blocked.status, 403);
  assert.equal(settings(env).draw_started, 1);
  assert.deepEqual(
    env.db.prepare('SELECT * FROM draw_plan ORDER BY giver_id').all(),
    snapshot,
  );
});

test('16. Solicitud de código: idempotencia, orden, límites y limpieza', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  const cooldownEnv = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  const releaseEnv = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  const ipEnv = createEnv({
    participants: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'],
  });
  t.after(() => env.cleanup());
  t.after(() => cooldownEnv.cleanup());
  t.after(() => releaseEnv.cleanup());
  t.after(() => ipEnv.cleanup());

  const { agent: adminAgent } = await loginAdmin(env);
  const p1 = participantByIndex(env, 0);
  const p2 = participantByIndex(env, 1);
  const p3 = participantByIndex(env, 2);

  const firstRequest = await requestCode(env, p1.id);
  assert.equal(firstRequest.status, 200);
  assert.equal(firstRequest.body.alreadyRequested, false);
  const repeated = await requestCode(env, p1.id);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.alreadyRequested, true);
  assert.equal(
    env.db
      .prepare(
        "SELECT COUNT(*) AS total FROM admin_log WHERE action='code_requested' AND participant_id=?",
      )
      .get(p1.id).total,
    1,
  );
  assert.equal((await requestCode(env, p2.id)).status, 200);

  const adminList = await adminAgent.get('/admin/participants');
  assert.equal(adminList.status, 200);
  assert.ok(adminList.body[0].codeRequestedAt);
  assert.ok(adminList.body[1].codeRequestedAt);
  const stats = await adminAgent.get('/admin/stats');
  assert.equal(stats.body.pendingRequests, 2);

  const claimed = await claimByIndex(env, 2);
  assert.equal(claimed.response.status, 200);
  assert.equal((await requestCode(env, p3.id)).status, 409);

  const otherAdmin = await loginAdmin(cooldownEnv);
  const cp1 = participantByIndex(cooldownEnv, 0);
  assert.equal((await requestCode(cooldownEnv, cp1.id)).status, 200);
  assert.equal(
    (await adminPost(otherAdmin.agent, `/admin/participants/${cp1.id}/mark-sent`, {})).status,
    200,
  );
  assert.equal(participantByIndex(cooldownEnv, 0).code_requested_at, null);
  assert.equal((await requestCode(cooldownEnv, cp1.id)).status, 429);
  cooldownEnv.db
    .prepare(
      "UPDATE admin_log SET created_at = ? WHERE participant_id = ? AND action='code_requested'",
    )
    .run(new Date(Date.now() - 6 * 60 * 1000).toISOString(), cp1.id);
  assert.equal((await requestCode(cooldownEnv, cp1.id)).status, 200);

  const releaseAdmin = await loginAdmin(releaseEnv);
  const rp1 = participantByIndex(releaseEnv, 0);
  assert.equal((await requestCode(releaseEnv, rp1.id)).status, 200);
  assert.equal(
    (
      await adminPost(
        releaseAdmin.agent,
        `/admin/participants/${rp1.id}/release`,
        { regenerateCode: true },
      )
    ).status,
    200,
  );
  assert.equal(participantByIndex(releaseEnv, 0).code_requested_at, null);

  const ipParticipants = allParticipants(ipEnv);
  const ipStatuses = [];
  for (const participant of ipParticipants) {
    ipStatuses.push((await requestCode(ipEnv, participant.id)).status);
  }
  assert.deepEqual(ipStatuses, [200, 200, 200, 200, 200, 429]);
});

test('18. Importación: empareja sin acentos, reporta errores y no guarda sin confirmar', async (t) => {
  const env = createEnv({ participants: ['José Álvarez', 'María López', 'Carlos Ruiz'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const text = [
    'JOSE ALVAREZ, 777 123 4567',
    'maría lópez\t+52 (999) 111-2233',
    'Pedro Inexistente, 555 123 4567',
    'Carlos Ruiz, 12345',
  ].join('\n');
  const preview = await adminPost(adminAgent, '/admin/participants/import/preview', { text });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.counts.matches, 2);
  assert.equal(preview.body.counts.notFound, 1);
  assert.equal(preview.body.counts.invalid, 1);
  assert.equal(
    env.db
      .prepare("SELECT COUNT(*) AS total FROM participants WHERE phone IS NOT NULL")
      .get().total,
    0,
  );
  const confirm = await adminPost(adminAgent, '/admin/participants/import/confirm', {
    previewToken: preview.body.previewToken,
  });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.updated, 2);
  const phones = env.db.prepare('SELECT name, phone FROM participants ORDER BY id').all();
  assert.deepEqual(phones, [
    { name: 'José Álvarez', phone: '527771234567' },
    { name: 'María López', phone: '529991112233' },
    { name: 'Carlos Ruiz', phone: null },
  ]);
});

test('19. El enlace wa.me usa el nombre actual tras renombrar y codifica el mensaje', async (t) => {
  const env = createEnv({ participants: ['Nombre Viejo', 'Otra Persona', 'Tercera Persona'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const participant = participantByIndex(env, 0);
  assert.equal(
    (
      await adminPut(adminAgent, `/admin/participants/${participant.id}/name`, {
        name: 'Nombre Nuevo',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await adminPut(adminAgent, `/admin/participants/${participant.id}/phone`, {
        phone: '777 123 4567',
      })
    ).status,
    200,
  );
  const data = (await adminAgent.get('/admin/participants')).body.find(
    (row) => row.id === participant.id,
  );
  const template = (await adminAgent.get('/admin/message-template')).body.template;
  const message = renderMessage(template, {
    nombre: data.name,
    url: ORIGIN,
    codigo: data.claimCode,
  });
  const link = buildWhatsAppLink(data.phone, message);
  assert.match(link, /^https:\/\/wa\.me\/527771234567\?text=/);
  const url = new URL(link);
  assert.equal(url.searchParams.get('text'), message);
  assert.match(url.searchParams.get('text'), /Nombre Nuevo/);
  assert.match(url.pathname, /527771234567/);
  assert.match(url.searchParams.get('text'), new RegExp(data.claimCode));
  assert.doesNotMatch(url.searchParams.get('text'), /Nombre Viejo/);
});

test('20. Privacidad: endpoints públicos no exponen teléfonos, códigos ni asignaciones', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const participant = participantByIndex(env, 0);
  assert.equal(
    (
      await adminPut(adminAgent, `/admin/participants/${participant.id}/phone`, {
        phone: '777 123 4567',
      })
    ).status,
    200,
  );
  const p2 = participantByIndex(env, 1);
  const requestResponse = await requestCode(env, p2.id);
  assert.equal(requestResponse.status, 200);

  const { agent } = await claimByIndex(env, 0);
  const available = await env.request().get('/api/participants/available');
  const wheel = await agent.get('/api/wheel-names');
  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.equal((await spin(env, agent)).status, 200);
  const me = await agent.get('/api/me');

  for (const response of [available, wheel, me, requestResponse]) {
    const text = JSON.stringify(response.body);
    assert.equal(text.includes('527771234567'), false);
    assert.equal(text.includes(participant.claim_code), false);
  }
  const adminRows = (await adminAgent.get('/admin/participants')).body;
  for (const row of adminRows) {
    assert.equal('receiverName' in row, false);
    assert.equal('receiver' in row, false);
  }
});

test('21. Rutas admin sin sesión 401 y Origin ajeno rechazado', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla'] });
  t.after(() => env.cleanup());
  const anonymous = env.agent();

  for (const route of [
    '/admin/participants',
    '/admin/stats',
    '/admin/log',
    '/admin/message-template',
    '/admin/backup',
  ]) {
    assert.equal((await anonymous.get(route)).status, 401, route);
  }
  assert.equal((await adminPost(anonymous, '/admin/start', { confirm: 'INICIAR' })).status, 401);
  assert.equal(
    (
      await env
        .request()
        .post('/admin/start')
        .send({ confirm: 'INICIAR' })
    ).status,
    401,
  );
  assert.equal((await adminPost(anonymous, '/admin/season-reset', {})).status, 401);
  assert.equal(
    (await adminDelete(anonymous, '/admin/participants/1', { confirmName: 'Ana' })).status,
    401,
  );

  const foreign = await env
    .request()
    .post('/admin/login')
    .set('Origin', 'https://sitio-malicioso.example')
    .send({ password: ADMIN_PASSWORD });
  assert.equal(foreign.status, 403);

  const { agent: adminAgent } = await loginAdmin(env);
  const foreignPut = await adminAgent
    .put('/admin/participants/1/phone')
    .set('Origin', 'https://sitio-malicioso.example')
    .send({ phone: '7771234567' });
  assert.equal(foreignPut.status, 403);
});

test('22. Season-reset sin confirmación, con contraseña incorrecta o sin confirmación activa no borra', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const { agent } = await claimByIndex(env, 0);
  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.equal((await spin(env, agent)).status, 200);
  const before = {
    participants: count(env, 'participants'),
    assignments: count(env, 'assignments'),
    plan: count(env, 'draw_plan'),
    started: settings(env).draw_started,
  };

  assert.equal((await adminPost(adminAgent, '/admin/season-reset', {})).status, 400);
  const wrongPassword = await adminPost(adminAgent, '/admin/season-reset', {
    confirm: 'BORRAR TODO',
    password: 'incorrecta',
  });
  assert.equal(wrongPassword.status, 401);
  const missingActive = await adminPost(adminAgent, '/admin/season-reset', {
    confirm: 'BORRAR TODO',
    password: ADMIN_PASSWORD,
  });
  assert.equal(missingActive.status, 409);

  assert.deepEqual(
    {
      participants: count(env, 'participants'),
      assignments: count(env, 'assignments'),
      plan: count(env, 'draw_plan'),
      started: settings(env).draw_started,
    },
    before,
  );
});

async function performSeasonReset(adminAgent) {
  return adminPost(adminAgent, '/admin/season-reset', {
    confirm: 'BORRAR TODO',
    password: ADMIN_PASSWORD,
    confirmActive: 'YA GIRARON, BORRAR IGUAL',
  });
}

test('23. Season-reset exitoso limpia todo, conserva plantilla, respalda y cierra sesión', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);
  const customTemplate =
    'Hola {nombre}, entra a {url} y usa {codigo}. Este mensaje es privado.';
  assert.equal(
    (
      await adminPut(adminAgent, '/admin/message-template', {
        template: customTemplate,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await adminPut(adminAgent, `/admin/participants/${participantByIndex(env, 0).id}/phone`, {
        phone: '777 123 4567',
      })
    ).status,
    200,
  );
  assert.equal((await requestCode(env, participantByIndex(env, 1).id)).status, 200);
  const claimed = await claimByIndex(env, 1);
  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.equal((await spin(env, claimed.agent)).status, 200);
  const oldCodes = allParticipants(env).map((participant) => participant.claim_code);

  const reset = await performSeasonReset(adminAgent);
  assert.equal(reset.status, 200);
  assert.ok(reset.body.backup);

  assert.equal(settings(env).draw_started, 0);
  assert.equal(settings(env).maintenance_mode, 0);
  assert.equal(count(env, 'assignments'), 0);
  assert.equal(count(env, 'draw_plan'), 0);
  const participants = allParticipants(env);
  assert.equal(participants.length, 4);
  assert.deepEqual(participants.map((p) => p.name), env.participants);
  assert.equal(new Set(participants.map((p) => p.claim_code)).size, 4);
  for (const participant of participants) {
    assert.equal(oldCodes.includes(participant.claim_code), false);
    assert.equal(participant.phone, null);
    assert.equal(participant.token_hash, null);
    assert.equal(participant.claimed_at, null);
    assert.equal(participant.code_requested_at, null);
    assert.equal(participant.code_sent_at, null);
  }
  const logRows = env.db.prepare('SELECT action FROM admin_log ORDER BY id').all();
  assert.equal(logRows.length, 1);
  assert.equal(logRows[0].action, 'season-reset');
  assert.equal(
    env.db.prepare("SELECT value FROM app_config WHERE key='message_template'").get().value,
    customTemplate,
  );

  const backupFiles = fs
    .readdirSync(env.backupDir)
    .filter((file) => /^app-\d{8}-\d{6}\.db$/.test(file));
  assert.ok(backupFiles.length >= 1);
  const backupDb = new Database(path.join(env.backupDir, backupFiles[0]), {
    readonly: true,
  });
  assert.equal(backupDb.prepare('SELECT COUNT(*) AS total FROM participants').get().total, 4);
  backupDb.close();

  assert.equal((await claimed.agent.get('/api/me')).status, 401);
  assert.equal((await adminAgent.get('/admin/stats')).status, 401);
  const newLogin = await loginAdmin(env);
  assert.equal(newLogin.response.status, 200);
});

test('24. Backup válido solo para admin y rollback completo si falla season-reset', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const { agent: adminAgent } = await loginAdmin(env);

  const anonymousBackup = await env.request().get('/admin/backup');
  assert.equal(anonymousBackup.status, 401);

  const backupResponse = await adminAgent
    .get('/admin/backup')
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  assert.equal(backupResponse.status, 200);
  assert.match(
    String(backupResponse.headers['content-disposition']),
    /attachment; filename=/,
  );
  assert.ok(Buffer.isBuffer(backupResponse.body));
  const backupPath = path.join(env.dir, 'downloaded-backup.db');
  fs.writeFileSync(backupPath, backupResponse.body);
  const backupDb = new Database(backupPath, { readonly: true });
  assert.equal(backupDb.prepare('SELECT COUNT(*) AS total FROM participants').get().total, 4);
  backupDb.close();

  const claimed = await claimByIndex(env, 0);
  assert.equal((await startDraw(env, adminAgent)).status, 200);
  assert.equal((await spin(env, claimed.agent)).status, 200);
  const before = {
    participants: count(env, 'participants'),
    assignments: count(env, 'assignments'),
    plan: count(env, 'draw_plan'),
    started: settings(env).draw_started,
    names: allParticipants(env).map((p) => p.name),
  };

  const originalPrepare = env.db.prepare.bind(env.db);
  let injected = false;
  env.db.prepare = function patchedPrepare(sql) {
    if (
      !injected &&
      typeof sql === 'string' &&
      sql.includes('INSERT INTO participants (name, phone, claim_code)')
    ) {
      injected = true;
      throw new Error('fallo inducido en la transacción');
    }
    return originalPrepare(sql);
  };

  let failed;
  try {
    failed = await performSeasonReset(adminAgent);
  } finally {
    env.db.prepare = originalPrepare;
  }
  assert.equal(injected, true);
  assert.equal(failed.status, 500);

  assert.deepEqual(
    {
      participants: count(env, 'participants'),
      assignments: count(env, 'assignments'),
      plan: count(env, 'draw_plan'),
      started: settings(env).draw_started,
      names: allParticipants(env).map((p) => p.name),
    },
    before,
  );
  assert.equal(settings(env).maintenance_mode, 0);
  assert.throws(
    () => env.db.prepare('UPDATE settings SET maintenance_mode = 1 WHERE id = 1').run(),
    /maintenance_mode|autorizada/i,
  );
});

test('25. Después de season-reset se puede completar un ciclo nuevo', async (t) => {
  const env = createEnv({ participants: ['Ana', 'Beto', 'Carla', 'Diego'] });
  t.after(() => env.cleanup());
  const firstAdmin = await loginAdmin(env);
  const firstClaimed = await claimByIndex(env, 0);
  assert.equal((await startDraw(env, firstAdmin.agent)).status, 200);
  assert.equal((await spin(env, firstClaimed.agent)).status, 200);
  assert.equal((await performSeasonReset(firstAdmin.agent)).status, 200);

  const secondAdmin = await loginAdmin(env);
  assert.equal(secondAdmin.response.status, 200);
  const participant = participantByIndex(env, 0);
  assert.equal(
    (
      await adminPut(secondAdmin.agent, `/admin/participants/${participant.id}/name`, {
        name: 'Ana Nueva',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await adminPut(secondAdmin.agent, `/admin/participants/${participantByIndex(env, 1).id}/phone`, {
        phone: '777 123 4567',
      })
    ).status,
    200,
  );
  assert.equal((await requestCode(env, participantByIndex(env, 2).id)).status, 200);
  const list = (await secondAdmin.agent.get('/admin/participants')).body;
  const target = list.find((row) => row.id === participantByIndex(env, 2).id);
  const newClaim = env.agent();
  assert.equal((await claim(env, newClaim, target.id, target.claimCode)).status, 200);
  assert.equal((await startDraw(env, secondAdmin.agent)).status, 200);
  const result = await spin(env, newClaim);
  assert.equal(result.status, 200);
  assert.ok(result.body.receiverName);
  assert.equal(count(env, 'assignments'), 1);
});
