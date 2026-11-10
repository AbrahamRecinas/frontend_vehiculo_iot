/**
 * ui.js
 * Interfaz de usuario: renderizado de conectividad, toasts, indicadores
 * y actualización visual de botones. Sin lógica de negocio aquí.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';

const UI = {
  elements: {},

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
   * Actualiza los tres semáforos de conectividad.
   */
  setConnectivity: (params) => {
    const { wss, aws, rds } = params || {};

    if (UI.elements.pillWss) {
      UI.elements.pillWss.className = 'status-pill status-pill--' + String(wss?.state || 'closed');
      UI.elements.pillWss.title = wss?.detail || 'WSS';
      if (UI.elements.descWss) UI.elements.descWss.textContent = wss?.detail || '--';
    }

    if (UI.elements.pillAws) {
      UI.elements.pillAws.className = 'status-pill status-pill--' + String(aws?.state || 'closed');
      UI.elements.pillAws.title = `API: ${aws?.detail || '--'}`;
      if (UI.elements.descAws) {
        UI.elements.descAws.textContent = aws?.detail || '--';
        UI.elements.descAws.title = aws?.state === 'online' ? `HTTP OK · Latencia: ${aws?.latencyMs ?? '--'} ms` : (aws?.error || 'Sin comunicación');
      }
    }

    // Amazon RDS: estado honesto y sin endpoint directo disponible en esta fase.
    if (UI.elements.pillRds) {
      UI.elements.pillRds.className = 'status-pill status-pill--unverified';
      UI.elements.pillRds.title = 'Estado de Amazon RDS (Sin verificar - sin endpoint dedicado)';
      if (UI.elements.descRds) UI.elements.descRds.textContent = 'Sin verificar';
    }

    // Sincronizar los LEDs minimales del Modo Mando (FASE 1)
    UI.syncMandoLeds({ wss, aws, rds });

    return { wss, aws, rds };
  },

  /**
   * Sincroniza los 3 LEDs minimales (WSS / AWS / RDS) del Modo Mando.
   * Verde = operativo, Rojo = caido/error, Gris = sin verificar / sin estado.
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
      const state = states[key]?.state;
      let ledClass = 'led-gray';
      if (state === 'online' || state === 'open') {
        ledClass = 'led-green';
      } else if (state === 'error' || state === 'offline' || state === 'closed') {
        ledClass = 'led-red';
      }
      el.className = `mando-led ${ledClass}`;
    });
  },

  /**
   * Fija el estado visual del semáforo WSS en "En línea · Operativo".
   * Se invoca directamente desde el manejador del evento open del WebSocket.
   */
  setWssOnline: (detail = 'En línea · Operativo') => {
    if (UI.elements.pillWss) {
      UI.elements.pillWss.className = 'status-pill status-pill--online';
      UI.elements.pillWss.title = 'WebSocket WSS Activo';
      if (UI.elements.descWss) {
        UI.elements.descWss.textContent = detail;
        UI.elements.descWss.title = 'Canal WSS operativo';
      }
    }
    const result = { wss: { state: 'online', detail }, aws: { state: 'online', detail: 'Operativo', latencyMs: 0 }, rds: { state: 'unverified', detail: 'Sin verificar' } };
    UI.syncMandoLeds(result);
    return result;
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
    if (!container) return;

    if (!Array.isArray(demos) || demos.length === 0) {
      container.innerHTML = '<span class="text-danger">No se encontraron demos disponibles.</span>';
      return;
    }

    container.innerHTML = demos
      .map((d) => {
        const name = String(d.nombre || d.name || d.titulo || d.id || 'Demo');
        const desc = String(d.descripcion || d.description || d.desc || 'Rutina de demostración automática.');
        const status = Number(d.id_comando) === CONFIG.COMMANDS.DEMO_FABRICA ? 'ACTIVE' : 'PENDING';
        return `
          <div class="d-flex justify-content-between align-items-center py-1 border-bottom border-secondary-subtle">
            <span class="text-light">${name}</span>
            <span class="badge text-bg-${status === 'ACTIVE' ? 'warning' : 'secondary'} font-monospace small">${status}</span>
          </div>
        `;
      })
      .join('');
  },

  /**
   * Llena dinámicamente el selector (<select>) con el catálogo de demos devuelto por GET /demos.
   */
  renderDemoSelect: (demos = []) => {
    const select = document.getElementById('demoSelect');
    if (!select) return;

    const list = Array.isArray(demos) ? demos : [];
    select.innerHTML = '<option value="">Selecciona una demo…</option>';

    list.forEach((d) => {
      const value = d?.id_demo ?? d?.id ?? d?.id_comando ?? d?.demo_id ?? d?.uuid ?? '';
      const name = d?.nombre || d?.name || d?.titulo || `Demo ${value}`;
      const opt = document.createElement('option');
      opt.value = String(value);
      opt.textContent = name;
      select.appendChild(opt);
    });
  },

  /**
   * Muestra el estado de error al cargar el catálogo de demos.
   */
  renderDemoError: () => {
    const container = document.getElementById('demosListContainer');
    if (container) {
      container.innerHTML = '<span class="text-danger">Error al cargar demos</span>';
    }
  },

  setDemoStatus: (isActive) => {
    const badge = UI.elements.demoStatusBadge;
    if (badge) {
      badge.textContent = isActive ? 'Activa' : 'Inactiva';
      badge.className = 'badge text-bg-' + (isActive ? 'warning' : 'secondary');
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
