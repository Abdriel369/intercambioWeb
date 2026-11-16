(function () {
  'use strict';

  const state = {
    participants: [],
    stats: null,
    template: '',
    publicUrl: '',
    provider: 'none',
    pendingFilter: false,
    requestFilter: false,
    releaseTarget: null,
    deleteTarget: null,
    startHasAlerts: false,
    pollTimer: null,
  };

  const el = {
    loginView: document.getElementById('login-view'),
    adminView: document.getElementById('admin-view'),
    loginForm: document.getElementById('login-form'),
    password: document.getElementById('admin-password'),
    loginError: document.getElementById('login-error'),
    loginSubmit: document.getElementById('login-submit'),
    logoutButton: document.getElementById('logout-button'),
    drawBanner: document.getElementById('draw-banner'),
    postStartAlert: document.getElementById('post-start-alert'),
    postStartAlertText: document.getElementById('post-start-alert-text'),
    prestartAlerts: document.getElementById('prestart-alerts'),
    alertsList: document.getElementById('alerts-list'),
    statPhone: document.getElementById('stat-phone'),
    statSent: document.getElementById('stat-sent'),
    statClaimed: document.getElementById('stat-claimed'),
    statSpun: document.getElementById('stat-spun'),
    statRequests: document.getElementById('stat-requests'),
    requestsStat: document.getElementById('requests-stat'),
    requestsCounter: document.getElementById('requests-counter'),
    requestsCount: document.getElementById('requests-count'),
    statState: document.getElementById('stat-state'),
    startButton: document.getElementById('start-button'),
    resetButton: document.getElementById('reset-button'),
    progressCard: document.getElementById('progress-card'),
    integrityBox: document.getElementById('integrity-box'),
    integrityIcon: document.getElementById('integrity-icon'),
    integrityTitle: document.getElementById('integrity-title'),
    integrityDetail: document.getElementById('integrity-detail'),
    verifyIntegrityButton: document.getElementById('verify-integrity-button'),
    progressSpun: document.getElementById('progress-spun'),
    progressSpunTotal: document.getElementById('progress-spun-total'),
    spunNamesList: document.getElementById('spun-names-list'),
    spunEmpty: document.getElementById('spun-empty'),
    progressPending: document.getElementById('progress-pending'),
    pendingNamesList: document.getElementById('pending-names-list'),
    pendingEmpty: document.getElementById('pending-empty'),
    giftsAssigned: document.getElementById('gifts-assigned'),
    giftsTotal: document.getElementById('gifts-total'),
    giftsPending: document.getElementById('gifts-pending'),
    riskNotice: document.getElementById('risk-notice'),
    unclaimedRiskNote: document.getElementById('unclaimed-risk-note'),
    templateInput: document.getElementById('template-input'),
    saveTemplateButton: document.getElementById('save-template-button'),
    templateStatus: document.getElementById('template-status'),
    publicUrl: document.getElementById('public-url'),
    participantsList: document.getElementById('participants-list'),
    participantsEmpty: document.getElementById('participants-empty'),
    pendingFilter: document.getElementById('pending-filter'),
    requestFilter: document.getElementById('request-filter'),
    addParticipantButton: document.getElementById('add-participant-button'),
    openImportButton: document.getElementById('open-import-button'),
    openBatchButton: document.getElementById('open-batch-button'),
    refreshButton: document.getElementById('refresh-button'),
    refreshLogButton: document.getElementById('refresh-log-button'),
    logList: document.getElementById('log-list'),
    startDialog: document.getElementById('start-dialog'),
    startForm: document.getElementById('start-form'),
    startClaimed: document.getElementById('start-claimed'),
    startTotal: document.getElementById('start-total'),
    startUnclaimedWarning: document.getElementById('start-unclaimed-warning'),
    startPendingWrap: document.getElementById('start-pending-wrap'),
    startPendingList: document.getElementById('start-pending-list'),
    startExtraWrap: document.getElementById('start-extra-wrap'),
    startExtraConfirm: document.getElementById('start-extra-confirm'),
    startConfirmInput: document.getElementById('start-confirm-input'),
    startConfirmButton: document.getElementById('start-confirm-button'),
    startError: document.getElementById('start-error'),
    resetDialog: document.getElementById('reset-dialog'),
    resetForm: document.getElementById('reset-form'),
    resetDescription: document.getElementById('reset-description'),
    resetConfirmInput: document.getElementById('reset-confirm-input'),
    resetConfirmButton: document.getElementById('reset-confirm-button'),
    resetError: document.getElementById('reset-error'),
    addDialog: document.getElementById('add-participant-dialog'),
    addForm: document.getElementById('add-participant-form'),
    addName: document.getElementById('add-name'),
    addPhone: document.getElementById('add-phone'),
    addError: document.getElementById('add-error'),
    addConfirmButton: document.getElementById('add-confirm-button'),
    deleteDialog: document.getElementById('delete-participant-dialog'),
    deleteForm: document.getElementById('delete-participant-form'),
    deleteName: document.getElementById('delete-name'),
    deleteConfirmInput: document.getElementById('delete-confirm-input'),
    deleteConfirmButton: document.getElementById('delete-confirm-button'),
    deleteError: document.getElementById('delete-error'),
    importDialog: document.getElementById('import-dialog'),
    importText: document.getElementById('import-text'),
    importError: document.getElementById('import-error'),
    importPreview: document.getElementById('import-preview'),
    importMatchedCount: document.getElementById('import-matched-count'),
    importNotfoundCount: document.getElementById('import-notfound-count'),
    importInvalidCount: document.getElementById('import-invalid-count'),
    importMatchedList: document.getElementById('import-matched-list'),
    importNotfoundList: document.getElementById('import-notfound-list'),
    importInvalidList: document.getElementById('import-invalid-list'),
    previewImportButton: document.getElementById('preview-import-button'),
    confirmImportButton: document.getElementById('confirm-import-button'),
    releaseDialog: document.getElementById('release-dialog'),
    releaseForm: document.getElementById('release-form'),
    releaseName: document.getElementById('release-name'),
    releaseRegenerate: document.getElementById('release-regenerate'),
    batchDialog: document.getElementById('batch-dialog'),
    batchProgress: document.getElementById('batch-progress'),
    batchList: document.getElementById('batch-list'),
    nextPendingButton: document.getElementById('next-pending-button'),
    seasonResetButton: document.getElementById('season-reset-button'),
    seasonResetDialog: document.getElementById('season-reset-dialog'),
    seasonResetForm: document.getElementById('season-reset-form'),
    seasonResetPassword: document.getElementById('season-reset-password'),
    seasonResetConfirm: document.getElementById('season-reset-confirm'),
    seasonActiveWrap: document.getElementById('season-active-wrap'),
    seasonResetActive: document.getElementById('season-reset-active'),
    seasonResetError: document.getElementById('season-reset-error'),
    seasonResetConfirmButton: document.getElementById('season-reset-confirm-button'),
    confirmDialog: document.getElementById('confirm-dialog'),
    confirmIcon: document.getElementById('confirm-icon'),
    confirmTitle: document.getElementById('confirm-title'),
    confirmMessage: document.getElementById('confirm-message'),
    confirmCancel: document.getElementById('confirm-cancel'),
    confirmAccept: document.getElementById('confirm-accept'),
    toast: document.getElementById('toast'),
  };

  let toastTimer = null;
  let importToken = null;

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { Accept: 'application/json' };
    const fetchOptions = { method, headers, credentials: 'same-origin' };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(options.body);
    }

    let response;
    try {
      response = await fetch(path, fetchOptions);
    } catch (error) {
      throw new Error('No pudimos conectar. Revisa tu conexión e intenta de nuevo.');
    }

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    }
    if (!response.ok) {
      const apiError = new Error(
        (data && data.error) || 'Ocurrió un error. Intenta de nuevo.',
      );
      apiError.status = response.status;
      apiError.data = data;
      throw apiError;
    }
    return data;
  }

  function showToast(message, type = 'info') {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.className = `toast${type === 'error' ? ' is-error' : ''}${
      type === 'success' ? ' is-success' : ''
    }`;
    el.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      el.toast.hidden = true;
    }, 4800);
  }

  function showLogin() {
    el.logoutButton.hidden = true;
    el.adminView.hidden = true;
    el.loginView.hidden = false;
    el.password.value = '';
    el.loginError.hidden = true;
    el.loginSubmit.disabled = false;
    el.loginSubmit.textContent = 'Entrar';
    window.setTimeout(() => el.password.focus(), 50);
  }

  function showAdmin() {
    el.loginView.hidden = true;
    el.adminView.hidden = false;
    el.logoutButton.hidden = false;
  }

  function handleError(error, fallback) {
    if (error.status === 401) {
      showLogin();
      showToast('Tu sesión terminó. Vuelve a entrar.', 'error');
      return;
    }
    showToast(error.message || fallback || 'Ocurrió un error.', 'error');
  }

  async function login(event) {
    event.preventDefault();
    el.loginSubmit.disabled = true;
    el.loginSubmit.textContent = 'Entrando…';
    el.loginError.hidden = true;
    try {
      await api('/admin/login', {
        method: 'POST',
        body: { password: el.password.value },
      });
      el.password.value = '';
      await loadDashboard();
    } catch (error) {
      el.loginError.textContent =
        error.status === 429
          ? 'Demasiados intentos. Espera 10 minutos antes de intentarlo de nuevo.'
          : error.message;
      el.loginError.hidden = false;
    } finally {
      el.loginSubmit.disabled = false;
      el.loginSubmit.textContent = 'Entrar';
    }
  }

  async function logout() {
    el.logoutButton.disabled = true;
    try {
      await api('/admin/logout', { method: 'POST', body: {} });
    } catch (error) {
      // Aunque falle la red, se oculta el panel en este navegador.
    } finally {
      el.logoutButton.disabled = false;
      showLogin();
    }
  }

  async function loadDashboard() {
    try {
      const [participants, stats, templateData, logData] = await Promise.all([
        api('/admin/participants'),
        api('/admin/stats'),
        api('/admin/message-template'),
        api('/admin/log'),
      ]);
      state.participants = participants;
      state.stats = stats;
      state.template = templateData.template;
      state.publicUrl = templateData.publicUrl;
      state.provider = templateData.whatsappProvider;
      el.templateInput.value = state.template;
      el.publicUrl.textContent = state.publicUrl;
      renderAll(logData.log);
      showAdmin();
      if (state.stats.drawStarted) await refreshProgress();
    } catch (error) {
      showLogin();
      if (error.status !== 401) showToast(error.message, 'error');
    }
  }

  async function refreshData(options = {}) {
    try {
      const [participants, stats, logData] = await Promise.all([
        api('/admin/participants'),
        api('/admin/stats'),
        api('/admin/log'),
      ]);
      state.participants = participants;
      state.stats = stats;
      renderAll(logData.log);
      if (state.stats.drawStarted) await refreshProgress();
    } catch (error) {
      if (!options.silent || error.status === 401) {
        handleError(error, 'No se pudieron actualizar los datos.');
      }
    }
  }

  function renderAll(logData) {
    renderStats();
    renderAlerts();
    renderParticipants();
    if (logData) renderLog(logData);
    if (el.batchDialog.open) renderBatch();
  }

  function collectAlerts() {
    const participants = state.participants;
    const duplicateMap = new Map();
    for (const participant of participants) {
      if (!participant.phone) continue;
      const list = duplicateMap.get(participant.phone) || [];
      list.push(participant.name);
      duplicateMap.set(participant.phone, list);
    }
    return {
      noPhone: participants.filter((participant) => !participant.phone),
      placeholders: participants.filter((participant) =>
        /^Participante \d+$/i.test(participant.name),
      ),
      unsent: participants.filter((participant) => !participant.codeSentAt),
      unclaimed: participants.filter((participant) => !participant.claimed),
      duplicatePhones: [...duplicateMap.entries()].filter(([, names]) => names.length > 1),
    };
  }

  function alertGroup(title, names, maxNames = 6) {
    const wrapper = document.createElement('div');
    wrapper.className = 'alert-group';
    const label = document.createElement('strong');
    label.textContent = `${title} (${names.length})`;
    const text = document.createElement('p');
    const shown = names.slice(0, maxNames).join(', ');
    const remaining = names.length - maxNames;
    text.textContent = remaining > 0 ? `${shown} y ${remaining} más` : shown;
    wrapper.append(label, text);
    return wrapper;
  }

  function alertGroups(alerts) {
    const groups = [];
    if (alerts.noPhone.length) groups.push(['Sin teléfono', alerts.noPhone.map((p) => p.name)]);
    if (alerts.placeholders.length) {
      groups.push(['Nombres aún genéricos', alerts.placeholders.map((p) => p.name)]);
    }
    if (alerts.unsent.length) {
      groups.push(['Sin código enviado', alerts.unsent.map((p) => p.name)]);
    }
    if (alerts.unclaimed.length) {
      groups.push(['Sin reclamar', alerts.unclaimed.map((p) => p.name)]);
    }
    if (alerts.duplicatePhones.length) {
      groups.push([
        'Teléfonos repetidos',
        alerts.duplicatePhones.map(([phone, names]) => `${phone}: ${names.join(' / ')}`),
      ]);
    }
    return groups;
  }

  function renderStats() {
    if (!state.stats) return;
    const stats = state.stats;
    el.statPhone.textContent = String(stats.withPhone);
    el.statSent.textContent = String(stats.codesSent);
    el.statClaimed.textContent = String(stats.claimed);
    el.statSpun.textContent = String(stats.spun);
    el.statRequests.textContent = String(stats.pendingRequests);

    for (const id of ['stat-phone', 'stat-sent', 'stat-claimed', 'stat-spun']) {
      const value = document.getElementById(id);
      const small = value && value.nextElementSibling;
      if (small) small.textContent = `/${stats.total}`;
    }

    const hasRequests = stats.pendingRequests > 0;
    el.requestsCounter.classList.toggle('is-on', hasRequests);
    el.requestsStat.classList.toggle('is-on', hasRequests);
    el.requestsCount.textContent = String(stats.pendingRequests);

    el.statState.textContent = stats.drawStarted ? 'Iniciado 🔒' : 'Sin iniciar';
    el.statState.classList.toggle('is-started', stats.drawStarted);
    el.drawBanner.hidden = !stats.drawStarted;
    if (!stats.drawStarted) el.progressCard.hidden = true;
    const canStart = !stats.drawStarted && stats.total >= 3;
    el.startButton.disabled = !canStart;
    el.startButton.textContent = stats.drawStarted ? 'Sorteo iniciado' : 'Iniciar sorteo';
    el.startButton.title =
      !stats.drawStarted && stats.total < 3
        ? 'Agrega al menos 3 participantes para iniciar.'
        : '';
    el.addParticipantButton.disabled = stats.drawStarted;
    el.resetButton.disabled = stats.spun > 0;
    el.resetButton.textContent = stats.drawStarted ? 'Reiniciar sorteo' : 'Reiniciar reclamos';
    el.resetButton.title =
      stats.spun > 0
        ? 'Ya hay personas que giraron. La temporada solo puede reiniciarse completa.'
        : '';
  }

  function renderIntegrity(result) {
    el.integrityBox.classList.remove('is-ok', 'is-error', 'is-checking');
    if (result && result.ok) {
      el.integrityBox.classList.add('is-ok');
      el.integrityIcon.textContent = '✔';
      el.integrityTitle.textContent =
        'Sorteo correcto: cada persona da a una sola persona y recibe de una sola persona';
      el.integrityDetail.textContent = 'Todas las verificaciones pasaron.';
    } else {
      el.integrityBox.classList.add('is-error');
      el.integrityIcon.textContent = '✖';
      el.integrityTitle.textContent = 'Se detectó un problema';
      el.integrityDetail.textContent =
        'Una verificación de integridad no pasó. No se muestran detalles para proteger las parejas.';
    }
  }

  function renderProgress(data) {
    el.progressCard.hidden = false;
    el.progressSpun.textContent = String(data.spun);
    el.progressSpunTotal.textContent = String(data.total);
    el.progressPending.textContent = String(data.pendingCount);
    el.giftsAssigned.textContent = String(data.giftsAssigned);
    el.giftsTotal.textContent = String(data.total);
    el.giftsPending.textContent = String(data.giftsPending);

    el.spunNamesList.replaceChildren();
    for (const name of data.spunNames) {
      const item = document.createElement('li');
      item.textContent = name;
      el.spunNamesList.append(item);
    }
    el.spunEmpty.hidden = data.spunNames.length > 0;

    el.pendingNamesList.replaceChildren();
    let hasUnclaimedPending = false;
    for (const participant of data.pending) {
      const item = document.createElement('li');
      item.textContent = participant.name;
      if (participant.unclaimed) {
        hasUnclaimedPending = true;
        item.classList.add('is-unclaimed');
        const tag = document.createElement('span');
        tag.className = 'unclaimed-tag';
        tag.textContent = 'Sin reclamar';
        item.append(tag);
      }
      el.pendingNamesList.append(item);
    }
    el.pendingEmpty.hidden = data.pending.length > 0;
    el.riskNotice.hidden = data.pendingCount === 0;
    el.unclaimedRiskNote.hidden = !hasUnclaimedPending;
  }

  async function refreshProgress() {
    if (!state.stats || !state.stats.drawStarted) {
      el.progressCard.hidden = true;
      return;
    }
    try {
      const [progress, integrity] = await Promise.all([
        api('/admin/progress'),
        api('/admin/integrity'),
      ]);
      renderProgress(progress);
      renderIntegrity(integrity);
    } catch (error) {
      if (error.status === 401) {
        handleError(error);
        return;
      }
      if (error.status === 409) {
        el.progressCard.hidden = true;
        return;
      }
      el.progressCard.hidden = false;
      el.integrityBox.classList.remove('is-ok', 'is-checking');
      el.integrityBox.classList.add('is-error');
      el.integrityIcon.textContent = '✖';
      el.integrityTitle.textContent = 'No se pudo verificar el sorteo';
      el.integrityDetail.textContent = 'Intenta de nuevo con “Verificar ahora”.';
    }
  }

  async function verifyIntegrityNow() {
    if (!state.stats || !state.stats.drawStarted) return;
    el.verifyIntegrityButton.disabled = true;
    el.verifyIntegrityButton.textContent = 'Verificando…';
    el.integrityBox.classList.remove('is-ok', 'is-error');
    el.integrityBox.classList.add('is-checking');
    el.integrityIcon.textContent = '…';
    el.integrityTitle.textContent = 'Verificando integridad…';
    el.integrityDetail.textContent = '';
    try {
      const result = await api('/admin/integrity');
      renderIntegrity(result);
    } catch (error) {
      if (error.status === 401) {
        handleError(error);
        return;
      }
      el.integrityBox.classList.add('is-error');
      el.integrityIcon.textContent = '✖';
      el.integrityTitle.textContent = 'No se pudo verificar el sorteo';
      el.integrityDetail.textContent = 'Intenta de nuevo.';
    } finally {
      el.verifyIntegrityButton.disabled = false;
      el.verifyIntegrityButton.textContent = 'Verificar ahora';
    }
  }

  function renderAlerts() {
    if (!state.stats) return;
    const alerts = collectAlerts();
    const anyAlerts =
      alerts.noPhone.length ||
      alerts.placeholders.length ||
      alerts.unsent.length ||
      alerts.unclaimed.length ||
      alerts.duplicatePhones.length;

    if (!state.stats.drawStarted && anyAlerts) {
      el.alertsList.replaceChildren();
      for (const [title, names] of alertGroups(alerts)) {
        el.alertsList.append(alertGroup(title, names));
      }
      el.prestartAlerts.hidden = false;
    } else {
      el.prestartAlerts.hidden = true;
    }

    if (state.stats.drawStarted && alerts.unclaimed.length > 0) {
      const shown = alerts.unclaimed.slice(0, 6).map((p) => p.name).join(', ');
      const remaining = alerts.unclaimed.length - 6;
      el.postStartAlertText.textContent = `${alerts.unclaimed.length} ${
        alerts.unclaimed.length === 1 ? 'persona sigue' : 'personas siguen'
      } sin reclamar su nombre: ${shown}${
        remaining > 0 ? ` y ${remaining} más` : ''
      }. Aún no podrán girar hasta que reclamen.`;
      el.postStartAlert.hidden = false;
    } else {
      el.postStartAlert.hidden = true;
    }
  }

  function createBadge(text, className) {
    const badge = document.createElement('span');
    badge.className = `badge ${className}`;
    badge.textContent = text;
    return badge;
  }

  function renderParticipants() {
    el.participantsList.replaceChildren();
    let visible = state.participants;
    if (state.pendingFilter) visible = visible.filter((p) => !p.codeSentAt);
    if (state.requestFilter) visible = visible.filter((p) => p.codeRequestedAt);
    el.participantsEmpty.hidden = visible.length > 0;
    for (const participant of visible) {
      el.participantsList.append(buildParticipantCard(participant));
    }
  }

  function buildParticipantCard(participant) {
    const requested = Boolean(participant.codeRequestedAt);
    const pendingSend = !participant.codeSentAt;
    const drawStarted = Boolean(state.stats && state.stats.drawStarted);
    const card = document.createElement('article');
    card.className = `participant-card${pendingSend ? ' is-pending' : ''}${
      requested ? ' is-requested' : ''
    }`;

    const head = document.createElement('div');
    head.className = 'participant-head';
    const identity = document.createElement('div');

    if (requested) {
      const indicator = document.createElement('div');
      indicator.className = 'request-indicator';
      const light = document.createElement('span');
      light.className = 'request-light';
      light.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = 'Solicitó su código';
      indicator.append(light, label);
      identity.append(indicator);
    }

    const name = document.createElement('h3');
    name.textContent = participant.name;
    const code = document.createElement('p');
    code.className = 'participant-code';
    code.textContent = `Código: ${participant.claimCode}`;
    identity.append(name, code);

    const badges = document.createElement('div');
    badges.className = 'participant-badges';
    badges.append(
      participant.claimed
        ? createBadge('Reclamado', 'badge--success')
        : createBadge('Sin reclamar', 'badge--neutral'),
    );
    if (participant.hasSpun) badges.append(createBadge('Ya giró', 'badge--spinned'));
    badges.append(
      participant.codeSentAt
        ? createBadge('Código enviado ✔', 'badge--success')
        : createBadge('Sin enviar', 'badge--warning'),
    );
    head.append(identity, badges);

    if (requested) {
      const note = document.createElement('p');
      note.className = 'participant-request-note';
      note.textContent = `Solicitó su código el ${formatDate(participant.codeRequestedAt)}.`;
      card.append(note);
      if (!participant.phone) {
        const warning = document.createElement('p');
        warning.className = 'participant-request-note participant-request-note--warning';
        warning.textContent =
          'Sin teléfono: captúralo para poder enviar el código.';
        card.append(warning);
      }
    }

    const nameRow = document.createElement('div');
    nameRow.className = 'name-row';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Nombre';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 60;
    nameInput.value = participant.name;
    nameInput.disabled = drawStarted;
    nameInput.setAttribute('aria-label', `Nombre de ${participant.name}`);
    const saveName = document.createElement('button');
    saveName.type = 'button';
    saveName.className = 'btn btn--ghost';
    saveName.textContent = 'Guardar nombre';
    saveName.disabled = drawStarted;
    saveName.addEventListener('click', () =>
      updateName(participant, nameInput, saveName),
    );
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        updateName(participant, nameInput, saveName);
      }
    });
    nameRow.append(nameLabel, nameInput, saveName);

    const phoneRow = document.createElement('div');
    phoneRow.className = 'phone-row';
    const phoneLabel = document.createElement('label');
    phoneLabel.textContent = 'Teléfono (solo dígitos con lada)';
    const phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    phoneInput.inputMode = 'tel';
    phoneInput.value = participant.phone || '';
    phoneInput.placeholder = 'Ej. 527771234567';
    phoneInput.setAttribute('aria-label', `Teléfono de ${participant.name}`);
    const savePhone = document.createElement('button');
    savePhone.type = 'button';
    savePhone.className = 'btn btn--ghost';
    savePhone.textContent = 'Guardar';
    savePhone.addEventListener('click', () =>
      updatePhone(participant, phoneInput, savePhone),
    );
    phoneInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        updatePhone(participant, phoneInput, savePhone);
      }
    });
    phoneRow.append(phoneLabel, phoneInput, savePhone);

    const actions = document.createElement('div');
    actions.className = 'participant-actions';

    const whatsapp = document.createElement('button');
    whatsapp.type = 'button';
    whatsapp.className = 'btn btn--green';
    whatsapp.textContent = 'Enviar por WhatsApp';
    whatsapp.disabled = !participant.phone;
    whatsapp.addEventListener('click', () =>
      openWhatsApp(participant, { confirmMark: true }),
    );

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn--ghost';
    copy.textContent = 'Copiar mensaje';
    copy.disabled = !participant.phone;
    copy.addEventListener('click', () => copyMessage(participant));

    actions.append(whatsapp, copy);

    if (state.provider !== 'none') {
      const auto = document.createElement('button');
      auto.type = 'button';
      auto.className = 'btn btn--gold';
      auto.textContent = 'Enviar automáticamente';
      auto.disabled = !participant.phone;
      auto.addEventListener('click', () => sendAutomatically(participant, auto));
      actions.append(auto);
    }

    const release = document.createElement('button');
    release.type = 'button';
    release.className = 'text-button';
    release.textContent = 'Liberar nombre';
    release.addEventListener('click', () => openRelease(participant));
    actions.append(release);

    if (!drawStarted) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text-button delete-participant-button';
      remove.textContent = 'Eliminar participante';
      remove.addEventListener('click', () => openDelete(participant));
      actions.append(remove);
    }

    card.append(head, nameRow, phoneRow, actions);
    return card;
  }

  function messageFor(participant) {
    const template = el.templateInput.value || state.template;
    return template
      .split('{nombre}')
      .join(participant.name)
      .split('{url}')
      .join(state.publicUrl)
      .split('{codigo}')
      .join(participant.claimCode);
  }

  function whatsappLink(participant) {
    const digits = String(participant.phone || '').replace(/\D/g, '');
    if (!/^\d{11,15}$/.test(digits)) {
      throw new Error('Ese teléfono todavía no es válido. Guárdalo de nuevo.');
    }
    return `https://wa.me/${digits}?text=${encodeURIComponent(messageFor(participant))}`;
  }

  async function updatePhone(participant, input, button) {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Guardando…';
    try {
      const result = await api(`/admin/participants/${participant.id}/phone`, {
        method: 'PUT',
        body: { phone: input.value },
      });
      participant.phone = result.phone;
      input.value = result.phone;
      if (state.stats) {
        state.stats.withPhone = state.participants.filter((item) => item.phone).length;
        renderStats();
        renderAlerts();
      }
      showToast(`Teléfono de ${participant.name} guardado.`, 'success');
      renderParticipants();
    } catch (error) {
      handleError(error, 'No se pudo guardar el teléfono.');
    } finally {
      button.disabled = false;
      button.textContent = 'Guardar';
    }
  }

  async function updateName(participant, input, button) {
    if (button.disabled) return;
    const name = input.value.trim();
    if (!name) {
      showToast('El nombre no puede estar vacío.', 'error');
      return;
    }
    if (name === participant.name) return;
    button.disabled = true;
    button.textContent = 'Guardando…';
    try {
      const result = await api(`/admin/participants/${participant.id}/name`, {
        method: 'PUT',
        body: { name },
      });
      participant.name = result.name;
      showToast('Nombre actualizado.', 'success');
      await refreshData();
    } catch (error) {
      handleError(error, 'No se pudo guardar el nombre.');
    } finally {
      button.disabled = false;
      button.textContent = 'Guardar nombre';
    }
  }

  async function markSent(participant) {
    try {
      await api(`/admin/participants/${participant.id}/mark-sent`, {
        method: 'POST',
        body: {},
      });
      showToast(`Código de ${participant.name} marcado como enviado.`, 'success');
      await refreshData();
    } catch (error) {
      handleError(error, 'No se pudo marcar el código como enviado.');
    }
  }

  async function openWhatsApp(participant, options = {}) {
    if (!participant.phone) {
      showToast('Primero guarda el teléfono de esa persona.', 'error');
      return;
    }
    let link;
    try {
      link = whatsappLink(participant);
    } catch (error) {
      showToast(error.message, 'error');
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = link;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    if (!options.confirmMark) return;
    const confirmed = await confirmAction({
      icon: '💬',
      title: '¿Ya lo enviaste?',
      message: `Marca el código de ${participant.name} como enviado solo cuando hayas enviado el mensaje por WhatsApp.`,
      confirmText: 'Sí, marcar enviado',
      cancelText: 'Todavía no',
    });
    if (confirmed) await markSent(participant);
  }

  async function copyMessage(participant) {
    const text = messageFor(participant);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.append(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      showToast(`Mensaje de ${participant.name} copiado.`, 'success');
    } catch (error) {
      showToast('No se pudo copiar el mensaje. Intenta de nuevo.', 'error');
    }
  }

  async function sendAutomatically(participant, button) {
    if (!participant.phone) return;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = 'Enviando…';
    try {
      await api(`/admin/participants/${participant.id}/send-auto`, {
        method: 'POST',
        body: {},
      });
      showToast(`Código enviado automáticamente a ${participant.name}.`, 'success');
      await refreshData();
    } catch (error) {
      handleError(error, 'No se pudo enviar automáticamente.');
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  function openRelease(participant) {
    state.releaseTarget = participant;
    el.releaseName.textContent = participant.name;
    el.releaseRegenerate.checked = true;
    el.releaseDialog.showModal();
  }

  async function confirmRelease(event) {
    event.preventDefault();
    const participant = state.releaseTarget;
    if (!participant) return;
    const submit = el.releaseForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Liberando…';
    try {
      const result = await api(`/admin/participants/${participant.id}/release`, {
        method: 'POST',
        body: { regenerateCode: el.releaseRegenerate.checked },
      });
      el.releaseDialog.close();
      showToast(
        el.releaseRegenerate.checked
          ? `Nombre liberado. Nuevo código: ${result.claimCode}. Envíalo por WhatsApp.`
          : `Nombre de ${participant.name} liberado con el mismo código.`,
        'success',
      );
      await refreshData();
    } catch (error) {
      handleError(error, 'No se pudo liberar el nombre.');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Liberar nombre';
    }
  }

  function openAddDialog() {
    if (state.stats && state.stats.drawStarted) {
      showToast('El sorteo ya inició. No se pueden agregar participantes.', 'error');
      return;
    }
    el.addName.value = '';
    el.addPhone.value = '';
    el.addError.hidden = true;
    el.addDialog.showModal();
    window.setTimeout(() => el.addName.focus(), 50);
  }

  async function addParticipant(event) {
    event.preventDefault();
    el.addConfirmButton.disabled = true;
    el.addConfirmButton.textContent = 'Agregando…';
    el.addError.hidden = true;
    try {
      await api('/admin/participants', {
        method: 'POST',
        body: { name: el.addName.value, phone: el.addPhone.value },
      });
      el.addDialog.close();
      showToast('Participante agregado.', 'success');
      await refreshData();
    } catch (error) {
      el.addError.textContent = error.message;
      el.addError.hidden = false;
    } finally {
      el.addConfirmButton.disabled = false;
      el.addConfirmButton.textContent = 'Agregar participante';
    }
  }

  function openDelete(participant) {
    if (state.stats && state.stats.drawStarted) {
      showToast('El sorteo ya inició. No se pueden eliminar participantes.', 'error');
      return;
    }
    if (state.participants.length <= 3) {
      showToast('Debe haber al menos 3 participantes.', 'error');
      return;
    }
    state.deleteTarget = participant;
    el.deleteName.textContent = participant.name;
    el.deleteConfirmInput.value = '';
    el.deleteConfirmButton.disabled = true;
    el.deleteError.hidden = true;
    el.deleteDialog.showModal();
    window.setTimeout(() => el.deleteConfirmInput.focus(), 50);
  }

  async function deleteParticipant(event) {
    event.preventDefault();
    const participant = state.deleteTarget;
    if (!participant) return;
    el.deleteConfirmButton.disabled = true;
    el.deleteConfirmButton.textContent = 'Eliminando…';
    el.deleteError.hidden = true;
    try {
      await api(`/admin/participants/${participant.id}`, {
        method: 'DELETE',
        body: { confirmName: el.deleteConfirmInput.value },
      });
      el.deleteDialog.close();
      showToast('Participante eliminado.', 'success');
      await refreshData();
    } catch (error) {
      el.deleteError.textContent = error.message;
      el.deleteError.hidden = false;
    } finally {
      el.deleteConfirmButton.disabled = false;
      el.deleteConfirmButton.textContent = 'Eliminar participante';
    }
  }

  async function openStartDialog() {
    if (!state.stats || state.stats.drawStarted) return;
    if (state.stats.total < 3) {
      showToast('Agrega al menos 3 participantes para iniciar el sorteo.', 'error');
      return;
    }
    el.startButton.disabled = true;
    try {
      const [participants, latest] = await Promise.all([
        api('/admin/participants'),
        api('/admin/stats'),
      ]);
      state.participants = participants;
      state.stats = latest;
      renderStats();
      renderAlerts();
      renderParticipants();
    } catch (error) {
      handleError(error, 'No se pudo consultar el estado del sorteo.');
      return;
    } finally {
      el.startButton.disabled = Boolean(
        !state.stats || state.stats.drawStarted || state.stats.total < 3,
      );
    }
    if (!state.stats || state.stats.drawStarted || state.stats.total < 3) return;

    const alerts = collectAlerts();
    const groups = alertGroups(alerts);
    state.startHasAlerts = groups.length > 0;
    el.startClaimed.textContent = String(state.stats.claimed);
    el.startTotal.textContent = String(state.stats.total);
    el.startConfirmInput.value = '';
    el.startExtraConfirm.checked = false;
    el.startExtraWrap.hidden = !state.startHasAlerts;
    el.startConfirmButton.disabled = true;
    el.startError.hidden = true;

    if (alerts.unclaimed.length > 0) {
      el.startUnclaimedWarning.textContent = `Hay ${alerts.unclaimed.length} ${
        alerts.unclaimed.length === 1 ? 'persona' : 'personas'
      } sin reclamar. Esas personas aún no podrán girar hasta reclamar su nombre. Después de iniciar ya no se podrá cambiar el sorteo.`;
      el.startUnclaimedWarning.hidden = false;
    } else {
      el.startUnclaimedWarning.hidden = true;
    }

    el.startPendingList.replaceChildren();
    if (groups.length) {
      for (const [title, names] of groups) {
        const group = document.createElement('div');
        group.className = 'start-pending__group';
        const strong = document.createElement('strong');
        strong.textContent = `${title}: `;
        group.append(strong, document.createTextNode(names.join(', ')));
        el.startPendingList.append(group);
      }
      el.startPendingWrap.hidden = false;
    } else {
      el.startPendingWrap.hidden = true;
    }

    el.startDialog.showModal();
    el.startDialog.scrollTop = 0;
    updateStartButton();
  }

  function updateStartButton() {
    const exact = el.startConfirmInput.value === 'INICIAR';
    const extraOk = !state.startHasAlerts || el.startExtraConfirm.checked;
    el.startConfirmButton.disabled = !(exact && extraOk);
  }

  async function startDraw(event) {
    event.preventDefault();
    if (el.startConfirmInput.value !== 'INICIAR') return;
    if (state.startHasAlerts && !el.startExtraConfirm.checked) return;
    el.startConfirmButton.disabled = true;
    el.startConfirmButton.textContent = 'Iniciando…';
    el.startError.hidden = true;
    try {
      await api('/admin/start', {
        method: 'POST',
        body: { confirm: 'INICIAR' },
      });
      el.startDialog.close();
      showToast('El sorteo quedó iniciado y congelado.', 'success');
      await refreshData();
    } catch (error) {
      el.startError.textContent = error.message;
      el.startError.hidden = false;
      el.startConfirmButton.disabled = false;
    } finally {
      el.startConfirmButton.textContent = 'Iniciar sorteo';
    }
  }

  function openResetDialog() {
    if (!state.stats) return;
    if (state.stats.spun > 0) {
      showToast(
        'Ya hay personas que giraron. Usa “Reiniciar temporada” si necesitas empezar de cero.',
        'error',
      );
      return;
    }
    el.resetDescription.textContent = state.stats.drawStarted
      ? 'Se borrará el plan del sorteo y el sorteo volverá a “Sin iniciar”. Se conservan los reclamos, nombres, teléfonos y códigos.'
      : 'Se borrarán los reclamos, las asignaciones y cualquier plan de sorteo. Se conservan nombres, teléfonos y códigos.';
    el.resetConfirmInput.value = '';
    el.resetConfirmButton.disabled = true;
    el.resetError.hidden = true;
    el.resetDialog.showModal();
    window.setTimeout(() => el.resetConfirmInput.focus(), 50);
  }

  async function resetDraw(event) {
    event.preventDefault();
    if (el.resetConfirmInput.value !== 'REINICIAR') return;
    el.resetConfirmButton.disabled = true;
    el.resetConfirmButton.textContent = 'Reiniciando…';
    el.resetError.hidden = true;
    try {
      await api('/admin/reset', {
        method: 'POST',
        body: { confirm: 'REINICIAR' },
      });
      el.resetDialog.close();
      showToast('El sorteo fue reiniciado.', 'success');
      await refreshData();
    } catch (error) {
      el.resetError.textContent = error.message;
      el.resetError.hidden = false;
      el.resetConfirmButton.disabled = false;
    } finally {
      el.resetConfirmButton.textContent = 'Reiniciar';
    }
  }

  function openImportDialog() {
    importToken = null;
    el.importPreview.hidden = true;
    el.importError.hidden = true;
    el.confirmImportButton.disabled = true;
    el.importDialog.showModal();
    window.setTimeout(() => el.importText.focus(), 50);
  }

  function fillPreviewList(list, items, renderItem, emptyText) {
    list.replaceChildren();
    if (items.length === 0) {
      const li = document.createElement('li');
      li.textContent = emptyText;
      list.append(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      renderItem(li, item);
      list.append(li);
    }
  }

  async function previewImport() {
    el.importError.hidden = true;
    el.confirmImportButton.disabled = true;
    importToken = null;
    const text = el.importText.value;
    if (!text.trim()) {
      el.importError.textContent = 'Pega al menos una línea para importar.';
      el.importError.hidden = false;
      return;
    }

    el.previewImportButton.disabled = true;
    el.previewImportButton.textContent = 'Revisando…';
    try {
      const preview = await api('/admin/participants/import/preview', {
        method: 'POST',
        body: { text },
      });
      importToken = preview.previewToken;
      el.importMatchedCount.textContent = String(preview.counts.matches);
      el.importNotfoundCount.textContent = String(preview.counts.notFound);
      el.importInvalidCount.textContent = String(preview.counts.invalid);

      fillPreviewList(
        el.importMatchedList,
        preview.matches,
        (li, item) => {
          const name = document.createElement('strong');
          name.textContent = item.name;
          const phone = document.createElement('span');
          phone.className = 'preview-phone';
          phone.textContent = ` → ${item.phone}`;
          li.append(name, phone);
        },
        'Ninguno',
      );
      fillPreviewList(
        el.importNotfoundList,
        preview.notFound,
        (li, item) => {
          li.textContent = `${item.name} (línea ${item.line})`;
        },
        'Ninguno',
      );
      fillPreviewList(
        el.importInvalidList,
        preview.invalid,
        (li, item) => {
          li.textContent = `${item.name || 'Línea'} (línea ${item.line}): ${item.reason}`;
        },
        'Ninguno',
      );

      el.importPreview.hidden = false;
      el.confirmImportButton.disabled = preview.counts.matches === 0;
    } catch (error) {
      handleError(error, 'No se pudo generar la vista previa.');
    } finally {
      el.previewImportButton.disabled = false;
      el.previewImportButton.textContent = 'Vista previa';
    }
  }

  async function confirmImport() {
    if (!importToken) return;
    el.confirmImportButton.disabled = true;
    el.confirmImportButton.textContent = 'Guardando…';
    try {
      const result = await api('/admin/participants/import/confirm', {
        method: 'POST',
        body: { previewToken: importToken },
      });
      el.importDialog.close();
      importToken = null;
      showToast(`Se guardaron ${result.updated} teléfonos.`, 'success');
      await refreshData();
    } catch (error) {
      el.importError.textContent = error.message;
      el.importError.hidden = false;
    } finally {
      el.confirmImportButton.disabled = false;
      el.confirmImportButton.textContent = 'Guardar teléfonos';
    }
  }

  function pendingWithPhone() {
    return state.participants.filter(
      (participant) => participant.phone && !participant.codeSentAt,
    );
  }

  function openBatch() {
    renderBatch();
    el.batchDialog.showModal();
  }

  function renderBatch() {
    const pending = pendingWithPhone();
    el.batchList.replaceChildren();
    el.batchProgress.textContent =
      pending.length === 0
        ? 'Todos los códigos con teléfono ya están marcados como enviados.'
        : `${pending.length} ${
            pending.length === 1 ? 'pendiente' : 'pendientes'
          } por enviar. Abre WhatsApp de una persona a la vez.`;
    el.nextPendingButton.disabled = pending.length === 0;

    for (const participant of pending) {
      const item = document.createElement('div');
      item.className = 'batch-item';
      if (participant === pending[0]) item.classList.add('is-next');

      const info = document.createElement('div');
      info.className = 'batch-item__info';
      const name = document.createElement('strong');
      name.textContent = participant.name;
      const phone = document.createElement('span');
      phone.textContent = participant.phone;
      info.append(name, phone);

      const send = document.createElement('button');
      send.type = 'button';
      send.className = 'btn btn--green';
      send.textContent = 'Abrir WhatsApp';
      send.addEventListener('click', () =>
        openWhatsApp(participant, { confirmMark: true }),
      );

      item.append(info, send);
      el.batchList.append(item);
    }
  }

  function nextPending() {
    const pending = pendingWithPhone();
    if (pending.length === 0) {
      showToast('No quedan códigos pendientes.', 'success');
      renderBatch();
      return;
    }
    openWhatsApp(pending[0], { confirmMark: true });
  }

  async function saveTemplate() {
    el.templateStatus.textContent = '';
    el.saveTemplateButton.disabled = true;
    el.saveTemplateButton.textContent = 'Guardando…';
    try {
      const result = await api('/admin/message-template', {
        method: 'PUT',
        body: { template: el.templateInput.value },
      });
      state.template = result.template;
      el.templateInput.value = result.template;
      el.templateStatus.textContent = 'Plantilla guardada ✔';
      window.setTimeout(() => {
        el.templateStatus.textContent = '';
      }, 3500);
    } catch (error) {
      handleError(error, 'No se pudo guardar la plantilla.');
    } finally {
      el.saveTemplateButton.disabled = false;
      el.saveTemplateButton.textContent = 'Guardar plantilla';
    }
  }

  async function refreshLog() {
    el.refreshLogButton.disabled = true;
    try {
      const data = await api('/admin/log');
      renderLog(data.log);
    } catch (error) {
      handleError(error, 'No se pudo actualizar el registro.');
    } finally {
      el.refreshLogButton.disabled = false;
    }
  }

  const actionLabels = {
    claim_success: 'Reclamó su nombre',
    claim_failed: 'Intento de código incorrecto',
    claim_locked: 'Nombre bloqueado por intentos fallidos',
    code_requested: 'Solicitó su código',
    release: 'Nombre liberado',
    release_regenerated_code: 'Nombre liberado y código regenerado',
    phone_updated: 'Teléfono actualizado',
    phones_imported: 'Teléfonos importados',
    code_marked_sent: 'Código marcado como enviado',
    code_sent_automatically: 'Código enviado automáticamente',
    participant_added: 'Participante agregado',
    participant_renamed: 'Participante renombrado',
    participant_deleted: 'Participante eliminado',
    draw_started: 'Sorteo iniciado',
    draw_reset_without_spins: 'Sorteo reiniciado sin giros',
    reset: 'Reclamos reiniciados',
    'season-reset': 'Temporada reiniciada',
    season_reset_denied: 'Intento fallido de reiniciar temporada',
    'integrity-failed': 'Falló una verificación de integridad del sorteo',
    backup_downloaded: 'Respaldo descargado',
    template_updated: 'Plantilla actualizada',
    admin_login: 'Inicio de sesión del administrador',
    admin_logout: 'Cierre de sesión del administrador',
    admin_login_failed: 'Intento de acceso fallido al panel',
  };

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  }

  function renderLog(entries) {
    el.logList.replaceChildren();
    if (!entries || entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-message';
      empty.textContent = 'Todavía no hay acciones registradas.';
      el.logList.append(empty);
      return;
    }

    const names = new Map(state.participants.map((p) => [p.id, p.name]));
    for (const entry of entries) {
      const item = document.createElement('div');
      item.className = 'log-item';
      const main = document.createElement('div');
      main.className = 'log-item__main';
      const action = document.createElement('strong');
      action.textContent = actionLabels[entry.action] || entry.action;
      main.append(action);
      if (entry.participantId && names.has(entry.participantId)) {
        const participant = document.createElement('span');
        participant.textContent = ` · ${names.get(entry.participantId)}`;
        main.append(participant);
      }
      const time = document.createElement('time');
      time.dateTime = entry.createdAt;
      time.textContent = formatDate(entry.createdAt);
      item.append(main, time);
      el.logList.append(item);
    }
  }

  function confirmAction(options) {
    return new Promise((resolve) => {
      el.confirmIcon.textContent = options.icon || '⚠️';
      el.confirmTitle.textContent = options.title || 'Confirmar';
      el.confirmMessage.textContent = options.message || '';
      el.confirmAccept.textContent = options.confirmText || 'Confirmar';
      el.confirmCancel.textContent = options.cancelText || 'Cancelar';
      el.confirmAccept.className = `btn ${options.danger ? 'btn--danger' : 'btn--primary'}`;

      let settled = false;
      const cleanup = () => {
        el.confirmAccept.onclick = null;
        el.confirmCancel.onclick = null;
        el.confirmDialog.oncancel = null;
        el.confirmDialog.onclick = null;
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        el.confirmDialog.close();
        resolve(value);
      };

      el.confirmAccept.onclick = () => finish(true);
      el.confirmCancel.onclick = () => finish(false);
      el.confirmDialog.oncancel = (event) => {
        event.preventDefault();
        finish(false);
      };
      el.confirmDialog.onclick = (event) => {
        if (event.target === el.confirmDialog) finish(false);
      };
      el.confirmDialog.showModal();
      el.confirmAccept.focus();
    });
  }

  function openSeasonReset() {
    el.seasonResetPassword.value = '';
    el.seasonResetConfirm.value = '';
    el.seasonResetActive.value = '';
    el.seasonResetError.hidden = true;
    const spun = state.stats ? state.stats.spun : 0;
    el.seasonActiveWrap.hidden = spun === 0;
    el.seasonResetConfirmButton.disabled = true;
    el.seasonResetDialog.showModal();
    el.seasonResetDialog.scrollTop = 0;
    window.setTimeout(() => el.seasonResetPassword.focus({ preventScroll: true }), 50);
    updateSeasonResetButton();
  }

  function updateSeasonResetButton() {
    const passwordOk = el.seasonResetPassword.value.length > 0;
    const confirmOk = el.seasonResetConfirm.value === 'BORRAR TODO';
    const activeRequired = !el.seasonActiveWrap.hidden;
    const activeOk =
      !activeRequired || el.seasonResetActive.value === 'YA GIRARON, BORRAR IGUAL';
    el.seasonResetConfirmButton.disabled = !(passwordOk && confirmOk && activeOk);
  }

  async function seasonReset(event) {
    event.preventDefault();
    el.seasonResetConfirmButton.disabled = true;
    el.seasonResetConfirmButton.textContent = 'Borrando todo…';
    el.seasonResetError.hidden = true;
    try {
      const body = {
        confirm: el.seasonResetConfirm.value,
        password: el.seasonResetPassword.value,
      };
      if (!el.seasonActiveWrap.hidden) {
        body.confirmActive = el.seasonResetActive.value;
      }
      await api('/admin/season-reset', { method: 'POST', body });
      el.seasonResetDialog.close();
      showLogin();
      showToast('Temporada reiniciada. Vuelve a iniciar sesión.', 'success');
    } catch (error) {
      if (error.message === 'No autorizado.') {
        showLogin();
        showToast('Tu sesión terminó.', 'error');
        return;
      }
      if (error.status === 409 && el.seasonActiveWrap.hidden) {
        el.seasonActiveWrap.hidden = false;
      }
      el.seasonResetError.textContent = error.message;
      el.seasonResetError.hidden = false;
      updateSeasonResetButton();
    } finally {
      el.seasonResetConfirmButton.textContent = 'Borrar todo y reiniciar';
    }
  }

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.closeDialog);
      if (dialog) dialog.close();
    });
  });

  el.loginForm.addEventListener('submit', login);
  el.logoutButton.addEventListener('click', logout);
  el.startButton.addEventListener('click', openStartDialog);
  el.resetButton.addEventListener('click', openResetDialog);
  el.verifyIntegrityButton.addEventListener('click', verifyIntegrityNow);
  el.pendingFilter.addEventListener('change', () => {
    state.pendingFilter = el.pendingFilter.checked;
    renderParticipants();
  });
  el.requestFilter.addEventListener('change', () => {
    state.requestFilter = el.requestFilter.checked;
    renderParticipants();
  });
  el.saveTemplateButton.addEventListener('click', saveTemplate);
  el.addParticipantButton.addEventListener('click', openAddDialog);
  el.openImportButton.addEventListener('click', openImportDialog);
  el.previewImportButton.addEventListener('click', previewImport);
  el.confirmImportButton.addEventListener('click', confirmImport);
  el.releaseForm.addEventListener('submit', confirmRelease);
  el.startForm.addEventListener('submit', startDraw);
  el.startConfirmInput.addEventListener('input', () => {
    el.startError.hidden = true;
    updateStartButton();
  });
  el.startExtraConfirm.addEventListener('change', updateStartButton);
  el.resetForm.addEventListener('submit', resetDraw);
  el.resetConfirmInput.addEventListener('input', () => {
    el.resetConfirmButton.disabled = el.resetConfirmInput.value !== 'REINICIAR';
    el.resetError.hidden = true;
  });
  el.addForm.addEventListener('submit', addParticipant);
  el.deleteForm.addEventListener('submit', deleteParticipant);
  el.deleteConfirmInput.addEventListener('input', () => {
    const target = state.deleteTarget;
    el.deleteConfirmButton.disabled =
      !target || el.deleteConfirmInput.value !== target.name;
    el.deleteError.hidden = true;
  });
  el.openBatchButton.addEventListener('click', openBatch);
  el.nextPendingButton.addEventListener('click', nextPending);
  el.refreshLogButton.addEventListener('click', refreshLog);
  el.refreshButton.addEventListener('click', async () => {
    el.refreshButton.disabled = true;
    el.refreshButton.textContent = 'Actualizando…';
    await refreshData();
    el.refreshButton.disabled = false;
    el.refreshButton.textContent = 'Actualizar';
  });
  el.seasonResetButton.addEventListener('click', openSeasonReset);
  el.seasonResetForm.addEventListener('submit', seasonReset);
  el.seasonResetPassword.addEventListener('input', updateSeasonResetButton);
  el.seasonResetConfirm.addEventListener('input', updateSeasonResetButton);
  el.seasonResetActive.addEventListener('input', updateSeasonResetButton);
  el.templateInput.addEventListener('input', () => {
    el.templateStatus.textContent = '';
  });

  function maybePoll() {
    if (el.adminView.hidden) return;
    if (document.visibilityState !== 'visible') return;
    if (document.querySelector('dialog[open]')) return;
    const active = document.activeElement;
    if (active && active.closest && active.closest('.participant-card')) return;
    if (active === el.templateInput) return;
    refreshData({ silent: true });
  }

  setInterval(maybePoll, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !el.adminView.hidden) {
      refreshData({ silent: true });
    }
  });

  async function boot() {
    showLogin();
    el.loginSubmit.disabled = true;
    el.loginSubmit.textContent = 'Revisando sesión…';
    try {
      await api('/admin/participants');
      await loadDashboard();
    } catch (error) {
      showLogin();
    }
  }

  boot();
})();
