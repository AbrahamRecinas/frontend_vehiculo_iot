/**
 * ui.js
 * Interfaz de usuario: renderizado de conectividad, toasts, indicadores
 * y actualización visual de botones. Sin lógica de negocio aquí.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';

const UI = {
  elements: {},
  connectivityState: {
    wss: { state: 'connecting', detail: 'Conectando...' },
    aws: { state: 'connecting', detail: 'Verificando...', latencyMs: null, httpStatus: null },
    rds: { state: 'unverified', detail: 'Sin verificar' },
  },

  init: () => {
    UI.elements = {
      pillWss: document.getElementById('pillWss'),
      pillAws: document.getElementById('pillAws'),
      pillRds: document.getElementById('pillRds'),
      descWss: document.getElementById('descWss'),
      descAws: document.getElementById('descAws'),
      descRds: document.getElementById('descRds'),
      diagPanel: document.getElementById('diagPanel'),
      btnToggleDiag: document.getElementById('btnToggleDiag'),
      btnCloseDiag: document.getElementById('btnCloseDiag'),
      btnRunDiag: document.getElementById('btnRunDiag'),
      diagRestUrl: document.getElementById('diagRestUrl'),
      diagWssUrl: document.getElementById('diagWssUrl'),
      diagLatency: document.getElementById('diagLatency'),
      diagHttpStatus: document.getElementById('diagHttpStatus'),
      diagWsReconnects: document.getElementById('diagWsReconnects'),
      diagLastWsMsg: document.getElementById('diagLastWsMsg'),
      btnEmergencyStop: document.getElementById('btnEmergencyStop'),
      activeCommandText: document.getElementById('activeCommandText'),
      activeCommandId: document.getElementById('activeCommandId'),
      pulseIndicator: document.getElementById('pulseIndicator'),
      joystickStateBadge: document.getElementById('joystickStateBadge'),
      joystickHelpText: document.getElementById('joystickHelpText'),
      joystickTrack: document.getElementById('joystickTrack'),
      joystickKnob: document.getElementById('joystickKnob'),
      btnIniciarDemo: document.getElementById('btnIniciarDemo'),
      btnCancelarDemo: document.getElementById('btnCancelarDemo'),
      demoStatusBadge: document.getElementById('demoStatusBadge'),
      btnPalaSubir: document.getElementById('btnPalaSubir'),
      btnPalaBajar: document.getElementById('btnPalaBajar'),
      btnGirarDer: document.getElementById('btnGirarDer'),
      btnGirarIzq: document.getElementById('btnGirarIzq'),
      btnLuces: document.getElementById('btnLuces'),
      btnSonido: document.getElementById('btnSonido'),
      btnEncender: document.getElementById('btnEncender'),
      btnApagar: document.getElementById('btnApagar'),
      btnEnterMando: document.getElementById('btnEnterMando'),
      btnExitMando: document.getElementById('btnExitMando'),
      lobbyView: document.getElementById('lobbyView'),
      mandoView: document.getElementById('mandoView'),
      joystickPanel: document.getElementById('joystickPanel'),
      dpadPanel: document.getElementById('dpadPanel'),
      mandoLedWss: document.getElementById('mandoLedWss'),
      mandoLedAws: document.getElementById('mandoLedAws'),
      mandoLedRds: document.getElementById('mandoLedRds'),
      vehicleBadge: document.getElementById('vehicleBadge'),
      toastContainer: document.getElementById('toastContainer'),
      currentYear: document.getElementById('currentYear'),
    };
  },

  /**
   * Actualiza un LED individual (en píldoras del header o en la barra compacta).
   */
  applyLedClass: (container, state) => {
    if (!container) return;
    const dot = container.querySelector('.status-led') || container;
    let ledClass = 'led-gray';
    if (state === 'online' || state === 'open') {
      ledClass = 'led-green';
    } else if (state === 'connecting') {
      ledClass = 'led-amber';
    } else if (state === 'error' || state === 'offline' || state === 'closed') {
      ledClass = 'led-red';
    }
    dot.className = `status-led ${ledClass}`;
  },

  /**
   * Actualiza los tres semáforos de conectividad conservando estados parciales previos.
   */
  setConnectivity: (params) => {
    const current = UI.connectivityState;
    const wss = params?.wss ? { ...current.wss, ...params.wss } : current.wss;
    const aws = params?.aws ? { ...current.aws, ...params.aws } : current.aws;
    const rds = { state: 'unverified', detail: 'Sin verificar', ...(params?.rds || {}) };
    UI.connectivityState = { wss, aws, rds };

    if (UI.elements.pillWss) {
      UI.elements.pillWss.className = 'status-pill status-pill--' + String(wss?.state || 'closed');
      UI.elements.pillWss.title = wss?.detail || 'WSS';
      UI.applyLedClass(UI.elements.pillWss, wss?.state);
      if (UI.elements.descWss) UI.elements.descWss.textContent = wss?.detail || '--';
    }

    if (UI.elements.pillAws) {
      UI.elements.pillAws.className = 'status-pill status-pill--' + String(aws?.state || 'closed');
      UI.elements.pillAws.title = `API: ${aws?.detail || '--'}`;
      UI.applyLedClass(UI.elements.pillAws, aws?.state);
      if (UI.elements.descAws) {
        UI.elements.descAws.textContent = aws?.detail || '--';
        UI.elements.descAws.title = aws?.state === 'online' ? `HTTP OK · Latencia: ${aws?.latencyMs ?? '--'} ms` : (aws?.error || 'Sin comunicación');
      }
    }

    // Amazon RDS: estado honesto y sin endpoint directo disponible en esta fase.
    if (UI.elements.pillRds) {
      UI.elements.pillRds.className = 'status-pill status-pill--unverified';
      UI.elements.pillRds.title = 'Estado de Amazon RDS (Sin verificar - sin endpoint dedicado)';
      UI.applyLedClass(UI.elements.pillRds, 'unverified');
      if (UI.elements.descRds) UI.elements.descRds.textContent = 'Sin verificar';
    }

    // Sincronizar los LEDs minimales del Modo Mando (FASE 1)
    UI.syncMandoLeds({ wss, aws, rds });

    return { wss, aws, rds };
  },

  /**
   * Sincroniza los 3 LEDs minimales (WSS / AWS / RDS) del Modo Mando.
   * Verde = operativo, Ámbar = conectando, Rojo = caído/error, Gris = sin verificar.
   */
  syncMandoLeds: (states = {}) => {
    const ledMap = {
      wss: 'mandoLedWss',
      aws: 'mandoLedAws',
      rds: 'mandoLedRds',
    };

    Object.entries(ledMap).forEach(([key, elId]) => {
      const el = UI.elements[elId];
      if (!el) return;
      UI.applyLedClass(el, states[key]?.state);
    });
  },

  /**
   * Fija el estado visual del semáforo WSS en "En línea · Operativo".
   * Se invoca directamente desde el manejador del evento open del WebSocket.
   */
  setWssOnline: (detail = 'En línea · Operativo') => {
    return UI.setConnectivity({
      wss: { state: 'online', detail },
    });
  },

  /**
   * Actualiza los campos del panel de diagnóstico con métricas reales.
   */
  updateDiagnostics: (info = {}) => {
    if (UI.elements.diagRestUrl && info.restUrl) {
      UI.elements.diagRestUrl.textContent = info.restUrl;
    }
    if (UI.elements.diagWssUrl && info.wssUrl) {
      UI.elements.diagWssUrl.textContent = info.wssUrl;
    }
    if (UI.elements.diagLatency && info.latencyMs !== undefined) {
      UI.elements.diagLatency.textContent = Number.isFinite(info.latencyMs) ? `${info.latencyMs} ms` : '-- ms';
    }
    if (UI.elements.diagHttpStatus && info.httpStatus !== undefined) {
      UI.elements.diagHttpStatus.textContent = info.httpStatus ? String(info.httpStatus) : 'Sin respuesta';
    }
    if (UI.elements.diagWsReconnects && info.wsReconnects !== undefined) {
      UI.elements.diagWsReconnects.textContent = String(info.wsReconnects ?? 0);
    }
    if (UI.elements.diagLastWsMsg && info.lastWsMessage !== undefined) {
      const raw = info.lastWsMessage;
      UI.elements.diagLastWsMsg.textContent = raw ? String(raw) : 'Ninguno';
      UI.elements.diagLastWsMsg.title = raw ? String(raw) : 'Ninguno';
    }
  },

  /**
   * FASE 1: alterna entre el Lobby (vista inicial movil) y el Modo Mando.
   * En PC (>= 768px) el Lobby nunca se muestra: arranca directamente en el Modo Mando.
   */
  setMandoMode: (isActive) => {
    const mando = document.getElementById('mandoView');
    const lobby = document.getElementById('lobbyView');

    if (mando) mando.classList.toggle('is-visible', Boolean(isActive));
    if (lobby) lobby.classList.toggle('is-visible', !isActive);

    // Marca global para condicionar textos largos vs LEDs minimales (solo movil)
    document.body.classList.toggle('mando-mode', Boolean(isActive));

    // FASE UX: dirección explícita del layout de control mientras esté activo
    // (mantiene la fila gamepad en cualquier dispositivo; se limpia al salir)
    document.body.classList.toggle('mando-control', Boolean(isActive));

    return isActive;
  },

  /**
   * FASE 4: exclusión mutua entre el Joystick y la Cruceta D-Pad.
   * controller: 'joystick' | 'dpad' | null
   */
  setControllerLock: (controller) => {
    const joystickPanel = document.getElementById('joystickPanel');
    const dpadPanel = document.getElementById('dpadPanel');

    if (joystickPanel) {
      joystickPanel.classList.toggle('joystick-disabled', controller === 'dpad');
      joystickPanel.classList.toggle('disabled-control', controller === 'dpad');
    }
    if (dpadPanel) {
      dpadPanel.classList.toggle('dpad-disabled', controller === 'joystick');
      dpadPanel.classList.toggle('disabled-control', controller === 'joystick');
    }

    return controller;
  },

  setCommandState: (cmdId = CONFIG.COMMANDS.DETENER, label = 'VEHÍCULO DETENIDO') => {
    if (UI.elements.activeCommandText) {
      UI.elements.activeCommandText.textContent = label;
    }
    if (UI.elements.activeCommandId) {
      UI.elements.activeCommandId.textContent = `ID: ${cmdId}`;
    }
  },

  setPulseState: (state) => {
    if (UI.elements.pulseIndicator) {
      UI.elements.pulseIndicator.className = 'pulse-indicator ' + (state || 'active-stopped');
    }
  },

  setActionButtonActive: (btnId, isActive) => {
    const btn = UI.elements[btnId];
    if (!btn) return;
    if (isActive) {
      btn.classList.add('btn-active-highlight');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.classList.remove('btn-active-highlight');
      btn.setAttribute('aria-pressed', 'false');
    }
  },

  setActionButtonBusy: (btnId, isBusy) => {
    const btn = UI.elements[btnId];
    if (btn) btn.disabled = isBusy;
  },

  showToast: (message, type = 'info') => {
    const container = UI.elements.toastContainer;
    if (!container) return;

    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center border-0 text-bg-${type} shadow-sm`;
    toastEl.setAttribute('role', 'alert');
    toastEl.innerHTML = `
      <div class="d-flex">
        <div class="toast-body small text-white fw-semibold">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button>
      </div>
    `;

    const bootstrapToast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 4500 });
    bootstrapToast.show();

    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
  },

  renderDemos: (demos = []) => {
    const container = document.getElementById('demosListContainer');
    const select = document.getElementById('demoSelect');
    if (!container) return;

    container.textContent = '';
    if (!Array.isArray(demos) || demos.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'demo-empty';
      empty.textContent = 'No hay rutinas registradas.';
      container.appendChild(empty);
      return;
    }

    demos.forEach((d, index) => {
      const value = String(d?.id_demo ?? d?.id ?? d?.id_comando ?? d?.demo_id ?? d?.uuid ?? index + 1);
      const name = String(d.nombre || d.name || d.titulo || `Rutina #${value}`);
      const desc = String(d.descripcion || d.description || d.desc || 'Secuencia automática lista para ejecutar.');

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'demo-catalog-item';
      item.dataset.demoId = value;

      const top = document.createElement('div');
      top.className = 'demo-catalog-top';

      const title = document.createElement('strong');
      title.className = 'demo-catalog-name';
      title.textContent = name;

      const code = document.createElement('span');
      code.className = 'demo-catalog-id';
      code.textContent = `#${value}`;

      const detail = document.createElement('span');
      detail.className = 'demo-catalog-desc';
      detail.textContent = desc;

      top.append(title, code);
      item.append(top, detail);

      item.addEventListener('click', () => {
        if (select) {
          select.value = value;
          select.dispatchEvent(new Event('change'));
        }
      });

      container.appendChild(item);
    });

    UI.syncSelectedDemoCard(select?.value);
  },

  syncSelectedDemoCard: (selectedValue = '') => {
    const container = document.getElementById('demosListContainer');
    if (!container) return;
    const value = String(selectedValue || '');
    container.querySelectorAll('.demo-catalog-item').forEach((card) => {
      const isSelected = card.dataset.demoId === value;
      card.classList.toggle('is-selected', isSelected);
      card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
  },

  /**
   * Llena dinámicamente el selector (<select>) con el catálogo de demos devuelto por GET /demos.
   */
  renderDemoSelect: (demos = []) => {
    const select = document.getElementById('demoSelect');
    if (!select) return;

    const list = Array.isArray(demos) ? demos : [];
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = list.length > 0 ? 'Selecciona una rutina…' : 'Sin rutinas disponibles';
    select.appendChild(placeholder);

    list.forEach((d, index) => {
      const value = d?.id_demo ?? d?.id ?? d?.id_comando ?? d?.demo_id ?? d?.uuid ?? index + 1;
      const name = d?.nombre || d?.name || d?.titulo || `Rutina ${value}`;
      const opt = document.createElement('option');
      opt.value = String(value);
      opt.textContent = `${name}`;
      select.appendChild(opt);
    });

    if (list.length > 0) {
      const firstValue = list[0]?.id_demo ?? list[0]?.id ?? list[0]?.id_comando ?? list[0]?.demo_id ?? list[0]?.uuid ?? 1;
      select.value = String(firstValue);
    }

    if (!select.dataset.boundSync) {
      select.addEventListener('change', () => UI.syncSelectedDemoCard(select.value));
      select.dataset.boundSync = 'true';
    }
    UI.syncSelectedDemoCard(select.value);
  },

  /**
   * Muestra el estado de error al cargar el catálogo de demos.
   */
  renderDemoError: () => {
    const container = document.getElementById('demosListContainer');
    if (container) {
      container.textContent = '';
      const err = document.createElement('div');
      err.className = 'demo-empty demo-empty--error';
      err.textContent = 'No se pudo sincronizar el catálogo de rutinas.';
      container.appendChild(err);
    }
  },

  setDemoStatus: (isActive) => {
    const badge = UI.elements.demoStatusBadge;
    const card = document.getElementById('demoCard');
    if (badge) {
      badge.textContent = isActive ? 'En ejecución' : 'Inactiva';
      badge.className = 'demo-status-pill ' + (isActive ? 'is-running' : '');
    }
    if (card) {
      card.classList.toggle('is-running', Boolean(isActive));
    }
  },

  setStopButtonState: (isActive) => {
    const btn = UI.elements.btnEmergencyStop;
    if (btn) {
      btn.classList.toggle('btn-danger', !isActive);
      btn.classList.toggle('btn-secondary', isActive);
    }
  },

  setJoystickState: (state) => {
    const badge = UI.elements.joystickStateBadge;
    if (badge) {
      badge.textContent = state;
      badge.className = 'badge text-bg-secondary';
    }
  },
};

export { UI };
export default UI;
