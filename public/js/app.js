(function () {
  'use strict';

  const state = {
    me: null,
    selected: null,
    names: null,
    wheel: null,
    spinning: false,
  };

  const el = {
    loadingView: document.getElementById('loading-view'),
    claimView: document.getElementById('claim-view'),
    participantView: document.getElementById('participant-view'),
    availableCard: document.getElementById('available-card'),
    availableList: document.getElementById('available-list'),
    availableEmpty: document.getElementById('available-empty'),
    claimPanel: document.getElementById('claim-panel'),
    selectedName: document.getElementById('selected-name'),
    claimOptions: document.getElementById('claim-options'),
    chooseCodeButton: document.getElementById('choose-code-button'),
    requestCodeButton: document.getElementById('request-code-button'),
    requestStatus: document.getElementById('request-status'),
    backToOptions: document.getElementById('back-to-options'),
    claimForm: document.getElementById('claim-form'),
    claimCode: document.getElementById('claim-code'),
    claimError: document.getElementById('claim-error'),
    claimSubmit: document.getElementById('claim-submit'),
    cancelClaim: document.getElementById('cancel-claim'),
    participantName: document.getElementById('participant-name'),
    notStartedCard: document.getElementById('not-started-card'),
    refreshStatus: document.getElementById('refresh-status'),
    spinSection: document.getElementById('spin-section'),
    spinButton: document.getElementById('spin-button'),
    spinHint: document.getElementById('spin-hint'),
    spinError: document.getElementById('spin-error'),
    resultCard: document.getElementById('result-card'),
    resultName: document.getElementById('result-name'),
    wheel: document.getElementById('wheel'),
    toast: document.getElementById('toast'),
    modalRoot: document.getElementById('modal-root'),
  };

  let toastTimer = null;
  let errorTimer = null;

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
      const networkError = new Error(
        'No pudimos conectar. Revisa tu conexión e intenta de nuevo.',
      );
      networkError.isNetwork = true;
      throw networkError;
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

  function showView(name) {
    el.loadingView.hidden = name !== 'loading';
    el.claimView.hidden = name !== 'claim';
    el.participantView.hidden = name !== 'participant';
  }

  function showToast(message, type = 'info') {
    if (!el.toast) return;
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.className = `toast${type === 'error' ? ' is-error' : ''}${
      type === 'success' ? ' is-success' : ''
    }`;
    el.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      el.toast.hidden = true;
    }, 4200);
  }

  function showFormError(node, message) {
    clearTimeout(errorTimer);
    node.textContent = message;
    node.hidden = false;
    errorTimer = window.setTimeout(() => {
      node.hidden = true;
    }, 7000);
  }

  function hideFormError(node) {
    node.hidden = true;
    node.textContent = '';
  }

  function showFatal(message) {
    showView('loading');
    const card = el.loadingView;
    card.replaceChildren();
    const icon = document.createElement('div');
    icon.className = 'status-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🎄';
    const title = document.createElement('h2');
    title.textContent = 'No pudimos abrir el intercambio';
    const text = document.createElement('p');
    text.textContent = message;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn--primary';
    retry.textContent = 'Intentar de nuevo';
    retry.addEventListener('click', () => window.location.reload());
    card.append(icon, title, text, retry);
  }

  function modalConfirm(options) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'modal';
      dialog.setAttribute('aria-label', options.title);

      const icon = document.createElement('div');
      icon.className = 'modal-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = options.icon || '🎁';

      const title = document.createElement('h2');
      title.textContent = options.title;

      const message = document.createElement('p');
      message.className = 'modal-lead';
      message.textContent = options.message;

      const actions = document.createElement('div');
      actions.className = 'modal-actions';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn--ghost';
      cancel.textContent = options.cancelText || 'Cancelar';

      const accept = document.createElement('button');
      accept.type = 'button';
      accept.className = `btn ${options.danger ? 'btn--danger' : 'btn--primary'}`;
      accept.textContent = options.confirmText || 'Confirmar';

      if (options.eyebrow) {
        const eyebrow = document.createElement('p');
        eyebrow.className = 'eyebrow';
        eyebrow.textContent = options.eyebrow;
        dialog.append(eyebrow);
      }

      dialog.append(icon, title, message, actions);
      actions.append(cancel, accept);
      el.modalRoot.replaceChildren(dialog);
      dialog.showModal();
      accept.focus();

      let settled = false;
      const close = (value) => {
        if (settled) return;
        settled = true;
        dialog.close();
        dialog.remove();
        resolve(value);
      };

      cancel.addEventListener('click', () => close(false));
      accept.addEventListener('click', () => close(true));
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        close(false);
      });
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) close(false);
      });
    });
  }

  async function loadAvailable() {
    showView('loading');
    try {
      const data = await api('/api/participants/available');
      renderAvailable(data.participants || []);
      showView('claim');
    } catch (error) {
      showFatal(error.message);
    }
  }

  function renderAvailable(participants) {
    el.availableList.replaceChildren();
    el.availableEmpty.hidden = participants.length > 0;
    el.availableCard.hidden = false;
    el.claimPanel.hidden = true;

    for (const participant of participants) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'name-chip';
      button.textContent = participant.name;
      button.addEventListener('click', () => selectParticipant(participant));
      el.availableList.append(button);
    }
    window.requestAnimationFrame(() => {
      el.availableList.querySelector('button')?.focus({ preventScroll: true });
    });
  }

  function selectParticipant(participant) {
    state.selected = participant;
    el.selectedName.textContent = participant.name;
    el.claimCode.value = '';
    hideFormError(el.claimError);
    el.claimForm.hidden = true;
    el.claimOptions.hidden = false;
    el.requestStatus.hidden = true;
    el.requestStatus.textContent = '';
    el.requestStatus.classList.remove('is-error');
    el.requestCodeButton.disabled = false;
    el.availableCard.hidden = true;
    el.claimPanel.hidden = false;
    el.claimPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function cancelSelection() {
    state.selected = null;
    el.claimPanel.hidden = true;
    el.availableCard.hidden = false;
    el.claimCode.value = '';
    el.claimForm.hidden = true;
    el.claimOptions.hidden = false;
    el.requestStatus.hidden = true;
    hideFormError(el.claimError);
    el.availableCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showCodeForm() {
    el.claimOptions.hidden = true;
    el.claimForm.hidden = false;
    el.claimCode.focus();
  }

  function backToOptions() {
    el.claimForm.hidden = true;
    el.claimOptions.hidden = false;
    el.claimError.hidden = true;
  }

  function showRequestStatus(message, isError = false) {
    el.requestStatus.textContent = message;
    el.requestStatus.classList.toggle('is-error', isError);
    el.requestStatus.hidden = false;
  }

  async function requestMyCode() {
    if (!state.selected || el.requestCodeButton.disabled) return;
    el.requestCodeButton.disabled = true;
    hideFormError(el.claimError);
    showRequestStatus('Avisando al organizador…');
    try {
      const result = await api('/api/request-code', {
        method: 'POST',
        body: { participantId: state.selected.id },
      });
      showRequestStatus(
        result.alreadyRequested
          ? 'Tu código ya fue solicitado. El organizador te lo enviará pronto.'
          : 'Listo, ya le avisamos al organizador. Te enviará tu código por WhatsApp en unos minutos; puede tardar un poco. Cuando lo recibas, vuelve aquí y escríbelo.',
      );
    } catch (error) {
      if (error.status === 409) {
        showToast('Ese nombre ya fue reclamado. Elige otro.', 'error');
        await loadAvailable();
      } else {
        showRequestStatus(error.message, true);
        el.requestCodeButton.disabled = false;
      }
    }
  }

  async function submitClaim(event) {
    event.preventDefault();
    if (!state.selected) return;

    const code = el.claimCode.value.trim().toUpperCase();
    if (code.length !== 6) {
      showFormError(el.claimError, 'Escribe el código completo de 6 caracteres.');
      el.claimCode.focus();
      return;
    }

    const confirmed = await modalConfirm({
      icon: '🎄',
      eyebrow: 'Confirma tu identidad',
      title: `¿Eres tú ${state.selected.name}?`,
      message: 'No podrás cambiarlo. Asegúrate de que este nombre sea el tuyo.',
      confirmText: 'Sí, soy yo',
      cancelText: 'Revisar',
    });
    if (!confirmed) return;

    el.claimSubmit.disabled = true;
    el.claimSubmit.textContent = 'Reclamando…';
    hideFormError(el.claimError);

    try {
      await api('/api/claim', {
        method: 'POST',
        body: { participantId: state.selected.id, claimCode: code },
      });
      const me = await api('/api/me');
      showToast(`¡Listo, ${me.name}! Tu nombre quedó reclamado.`, 'success');
      renderParticipant(me);
    } catch (error) {
      if (error.status === 409) {
        showToast('Ese nombre acaba de ser reclamado. Elige otro.', 'error');
        await loadAvailable();
      } else if (error.status === 429) {
        showFormError(
          el.claimError,
          'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.',
        );
      } else if (error.status === 400) {
        showFormError(el.claimError, error.message);
      } else {
        showFormError(el.claimError, error.message);
      }
    } finally {
      el.claimSubmit.disabled = false;
      el.claimSubmit.textContent = 'Reclamar mi nombre';
    }
  }

  function renderParticipant(me) {
    state.me = me;
    el.participantName.textContent = me.name;
    el.resultCard.hidden = true;
    el.notStartedCard.hidden = true;
    el.spinSection.hidden = true;
    hideFormError(el.spinError);
    showView('participant');

    if (me.hasSpun && me.receiverName) {
      showResult(me.receiverName, false);
      return;
    }

    if (!me.drawStarted) {
      el.notStartedCard.hidden = false;
      return;
    }

    el.spinSection.hidden = false;
    el.spinButton.disabled = true;
    el.spinButton.textContent = 'Cargando ruleta…';
    el.spinHint.textContent = 'Solo puedes girar una vez. Tu resultado se guarda al instante.';
    prepareWheel();
  }

  async function prepareWheel() {
    try {
      if (!state.names) {
        const data = await api('/api/wheel-names');
        state.names = data.names || [];
      }
      if (!state.wheel) state.wheel = new window.Wheel(el.wheel);
      state.wheel.setNames(state.names);
      el.spinButton.disabled = false;
      el.spinButton.textContent = '✨ Girar la ruleta';
      el.spinHint.textContent =
        'Solo puedes girar una vez. Tu resultado se guarda al instante.';
    } catch (error) {
      if (error.status === 401) {
        window.location.reload();
        return;
      }
      el.spinButton.disabled = true;
      el.spinButton.textContent = 'Ruleta no disponible';
      showFormError(el.spinError, error.message);
    }
  }

  async function doSpin() {
    if (state.spinning || !state.me || state.me.hasSpun) return;
    if (!state.wheel) {
      await prepareWheel();
      if (!state.wheel) return;
    }

    state.spinning = true;
    el.spinButton.disabled = true;
    el.spinButton.classList.add('is-spinning');
    el.spinButton.textContent = 'Preparando tu resultado…';
    hideFormError(el.spinError);

    try {
      const result = await api('/api/spin', { method: 'POST', body: {} });
      el.spinButton.textContent = 'Girando…';
      el.spinHint.textContent = 'La suerte ya está decidida. Mira la ruleta…';
      await state.wheel.spinTo(result.receiverName, 4600);
      state.me.hasSpun = true;
      state.me.receiverName = result.receiverName;
      state.spinning = false;
      showResult(result.receiverName, true);
      window.confettiBurst?.();
    } catch (error) {
      state.spinning = false;
      el.spinButton.classList.remove('is-spinning');
      if (error.status === 403) {
        state.me.drawStarted = false;
        el.spinSection.hidden = true;
        el.notStartedCard.hidden = false;
        showToast('El sorteo todavía no comienza.', 'error');
      } else if (error.status === 401) {
        showToast('Tu sesión expiró. Vuelve a reclamar tu nombre.', 'error');
        window.setTimeout(() => window.location.reload(), 1500);
      } else {
        el.spinButton.disabled = false;
        el.spinButton.textContent = '✨ Girar la ruleta';
        el.spinHint.textContent =
          'Solo puedes girar una vez. Tu resultado se guarda al instante.';
        showFormError(el.spinError, error.message);
      }
    }
  }

  function showResult(receiverName, celebrate) {
    el.resultName.textContent = receiverName;
    el.notStartedCard.hidden = true;
    el.spinSection.hidden = true;
    el.resultCard.hidden = false;
    el.spinButton.classList.remove('is-spinning');
    if (celebrate) {
      el.resultCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async function boot() {
    try {
      const me = await api('/api/me');
      renderParticipant(me);
    } catch (error) {
      if (error.status === 401) {
        await loadAvailable();
      } else {
        showFatal(error.message);
      }
    }
  }

  el.claimForm.addEventListener('submit', submitClaim);
  el.cancelClaim.addEventListener('click', cancelSelection);
  el.chooseCodeButton.addEventListener('click', showCodeForm);
  el.backToOptions.addEventListener('click', backToOptions);
  el.requestCodeButton.addEventListener('click', requestMyCode);
  el.claimCode.addEventListener('input', () => {
    el.claimCode.value = el.claimCode.value
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '')
      .slice(0, 6);
    hideFormError(el.claimError);
  });
  el.spinButton.addEventListener('click', doSpin);
  el.refreshStatus.addEventListener('click', async () => {
    el.refreshStatus.disabled = true;
    el.refreshStatus.textContent = 'Actualizando…';
    try {
      const me = await api('/api/me');
      renderParticipant(me);
    } catch (error) {
      if (error.status === 401) {
        window.location.reload();
      } else {
        showToast(error.message, 'error');
      }
    } finally {
      el.refreshStatus.disabled = false;
      el.refreshStatus.textContent = 'Actualizar estado';
    }
  });

  boot();
})();
