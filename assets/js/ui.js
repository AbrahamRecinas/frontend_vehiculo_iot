/**
 * ui.js
 * Interfaz de usuario: renderizado de conectividad, navegación por rol, toasts,
 * indicadores y actualización visual. Todo texto dinámico usa DOM API y textContent.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';

const ALL_VIEWS = ['auth', 'guest', 'user-vehicles', 'lobby', 'mando', 'monitor', 'admin'];

const ROLE_LABELS = Object.freeze({
  ADMIN: 'Admin',
  USUARIO: 'Usuario',
  INVITADO: 'Invitado',
});

const ROLE_BADGE_CLASSES = Object.freeze({
  ADMIN: 'text-bg-warning text-dark',
  USUARIO: 'text-bg-info text-dark',
  INVITADO: 'text-bg-secondary',
});

const UI = {
  elements: {},
  connectivityState: {
    wss: { state: 'closed', detail: 'En espera de sesión' },
    aws: { state: 'connecting', detail: 'Verificando...', latencyMs: null, httpStatus: null },
    rds: { state: 'connecting', detail: 'Verificando...' },
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
      authView: document.getElementById('authView'),
      guestView: document.getElementById('guestView'),
      userVehiclesView: document.getElementById('userVehiclesView'),
      lobbyView: document.getElementById('lobbyView'),
      mandoView: document.getElementById('mandoView'),
      monitorView: document.getElementById('monitorView'),
      adminView: document.getElementById('adminView'),
      joystickPanel: document.getElementById('joystickPanel'),
      dpadPanel: document.getElementById('dpadPanel'),
      mandoLedWss: document.getElementById('mandoLedWss'),
      mandoLedAws: document.getElementById('mandoLedAws'),
      mandoLedRds: document.getElementById('mandoLedRds'),
      vehicleBadge: document.getElementById('vehicleBadge'),
      monitorVehicleBadge: document.getElementById('monitorVehicleBadge'),
      monitorVehicleTitle: document.getElementById('monitorVehicleTitle'),
      lobbyVehicleTitle: document.getElementById('lobbyVehicleTitle'),
      monitorLastMovementCard: document.getElementById('monitorLastMovementCard'),
      monitorLastCommand: document.getElementById('monitorLastCommand'),
      monitorLastMeta: document.getElementById('monitorLastMeta'),
      monitorLastFecha: document.getElementById('monitorLastFecha'),
      monitorLastHora: document.getElementById('monitorLastHora'),
      monitorLastMovementStatus: document.getElementById('monitorLastMovementStatus'),
      monitorHistorialBody: document.getElementById('monitorHistorialBody'),
      monitorHistorialEmpty: document.getElementById('monitorHistorialEmpty'),
      monitorHistorialCount: document.getElementById('monitorHistorialCount'),
      monitorComandosBody: document.getElementById('monitorComandosBody'),
      monitorComandosEmpty: document.getElementById('monitorComandosEmpty'),
      monitorComandosCount: document.getElementById('monitorComandosCount'),
      headerUserWrap: document.getElementById('headerUserWrap'),
      headerUserRole: document.getElementById('headerUserRole'),
      headerUserName: document.getElementById('headerUserName'),
      btnHeaderLogout: document.getElementById('btnHeaderLogout'),
      btnHeaderLogin: document.getElementById('btnHeaderLogin'),
      envBadge: document.getElementById('envBadge'),
      toastContainer: document.getElementById('toastContainer'),
      currentYear: document.getElementById('currentYear'),
    };

    if (UI.elements.envBadge) {
      UI.elements.envBadge.textContent = CONFIG.ENV === 'local' ? 'LOCAL · 127.0.0.1' : 'AWS';
      UI.elements.envBadge.className =
        CONFIG.ENV === 'local'
          ? 'badge bg-warning-subtle text-warning border border-warning-subtle d-none d-md-inline-block'
          : 'badge bg-info-subtle text-info border border-info-subtle d-none d-md-inline-block';
    }
  },

  /**
   * Sincroniza la barra de usuario y visibilidad de menú según el rol autenticado.
   */
  syncAuthUi: (user = null) => {
    const rol = user?.rol || null;
    const isAuth = Boolean(rol);

    if (UI.elements.headerUserWrap) {
      UI.elements.headerUserWrap.classList.toggle('d-flex', isAuth);
      UI.elements.headerUserWrap.classList.toggle('d-none', !isAuth);
      UI.elements.headerUserWrap.hidden = !isAuth;
    }
    if (UI.elements.btnHeaderLogin) {
      UI.elements.btnHeaderLogin.classList.toggle('d-none', isAuth);
      UI.elements.btnHeaderLogin.hidden = isAuth;
    }

    if (isAuth) {
      if (UI.elements.headerUserRole) {
        UI.elements.headerUserRole.textContent = ROLE_LABELS[rol] || rol;
        UI.elements.headerUserRole.className = `badge ${ROLE_BADGE_CLASSES[rol] || 'text-bg-secondary'}`;
      }
      if (UI.elements.headerUserName) {
        UI.elements.headerUserName.textContent = user.nombre || user.correo || '';
      }
    } else {
      if (UI.elements.headerUserRole) UI.elements.headerUserRole.textContent = '';
      if (UI.elements.headerUserName) UI.elements.headerUserName.textContent = '';
    }

    // Mostrar únicamente los ítems de navegación permitidos para el rol activo
    document.querySelectorAll('[data-roles]').forEach((el) => {
      const allowed = String(el.dataset.roles || '')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      const key = rol || 'ANON';
      const visible = allowed.includes(key);
      el.hidden = !visible;
    });
  },

  /**
   * Actualiza badges y títulos con el nombre/ID de la unidad seleccionada.
   */
  updateVehicleContext: ({ id, nombre = '', estadoComercial = '' } = {}) => {
    const vid = id ?? CONFIG.VEHICLE_ID;
    const label = nombre ? `${nombre} (#${vid})` : `Vehículo #${vid}`;
    if (UI.elements.vehicleBadge) {
      UI.elements.vehicleBadge.textContent = estadoComercial
        ? `${label} · ${estadoComercial}`
        : label;
    }
    if (UI.elements.monitorVehicleBadge) {
      UI.elements.monitorVehicleBadge.textContent = `ID: ${vid}`;
    }
    if (UI.elements.monitorVehicleTitle) {
      UI.elements.monitorVehicleTitle.textContent = label;
    }
    if (UI.elements.lobbyVehicleTitle) {
      UI.elements.lobbyVehicleTitle.textContent = label;
    }
  },

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

  setConnectivity: (params) => {
    const current = UI.connectivityState;
    const wss = params?.wss ? { ...current.wss, ...params.wss } : current.wss;
    const aws = params?.aws ? { ...current.aws, ...params.aws } : current.aws;
    const rds = params?.rds ? { ...current.rds, ...params.rds } : current.rds;
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
        UI.elements.descAws.title =
          aws?.state === 'online'
            ? `HTTP OK · Latencia: ${aws?.latencyMs ?? '--'} ms`
            : aws?.error || 'Sin comunicación';
      }
    }

    if (UI.elements.pillRds) {
      UI.elements.pillRds.className = 'status-pill status-pill--' + String(rds?.state || 'unverified');
      UI.elements.pillRds.title = `Amazon RDS: ${rds?.detail || 'Sin verificar'}`;
      UI.applyLedClass(UI.elements.pillRds, rds?.state);
      if (UI.elements.descRds) UI.elements.descRds.textContent = rds?.detail || 'Sin verificar';
    }

    UI.syncMandoLeds({ wss, aws, rds });
    UI.syncLobby({ wss, aws, rds });

    return { wss, aws, rds };
  },

  /**
   * Actualiza el semáforo independiente de Amazon RDS a partir de GET /api/health.
   */
  setRdsStatus: (rdsInfo) => {
    if (rdsInfo?.ok) {
      return UI.setConnectivity({
        rds: { state: 'online', detail: rdsInfo.detail || 'Disponible' },
      });
    }
    return UI.setConnectivity({
      rds: { state: 'offline', detail: rdsInfo?.detail || 'No disponible' },
    });
  },

  syncLobby: (states = {}) => {
    const details = {
      wss: states.wss?.detail || '--',
      aws: states.aws?.detail || '--',
      rds: states.rds?.detail || 'Sin verificar',
    };

    document.querySelectorAll('[data-lobby-led]').forEach((led) => {
      const key = led.dataset.lobbyLed;
      UI.applyLedClass(led, states[key]?.state);
    });

    document.querySelectorAll('[data-lobby-detail]').forEach((el) => {
      const key = el.dataset.lobbyDetail;
      el.textContent = details[key] || '--';
    });
  },

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

  setWssOnline: (detail = 'En línea · Operativo') => {
    return UI.setConnectivity({
      wss: { state: 'online', detail },
    });
  },

  updateDiagnostics: (info = {}) => {
    if (UI.elements.diagRestUrl && info.restUrl) {
      UI.elements.diagRestUrl.textContent = info.restUrl;
    }
    if (UI.elements.diagWssUrl && info.wssUrl) {
      UI.elements.diagWssUrl.textContent = info.wssUrl;
    }
    if (UI.elements.diagLatency && info.latencyMs !== undefined) {
      UI.elements.diagLatency.textContent = Number.isFinite(info.latencyMs)
        ? `${info.latencyMs} ms`
        : '-- ms';
    }
    if (UI.elements.diagHttpStatus && info.httpStatus !== undefined) {
      UI.elements.diagHttpStatus.textContent = info.httpStatus
        ? String(info.httpStatus)
        : 'Sin respuesta';
    }
    if (UI.elements.diagWsReconnects && info.wsReconnects !== undefined) {
      UI.elements.diagWsReconnects.textContent = String(info.wsReconnects ?? 0);
    }
    if (UI.elements.diagLastWsMsg && info.lastWsMessage !== undefined) {
      const raw = info.lastWsMessage;
      UI.elements.diagLastWsMsg.textContent = raw ? String(raw) : 'Ninguno';
      UI.elements.diagLastWsMsg.title = raw ? String(raw) : 'Ninguno';
    }

    const setDiag = (key, text) => {
      document.querySelectorAll(`[data-diag="${key}"]`).forEach((el) => {
        el.textContent = text;
        el.title = text;
      });
    };
    if (info.restUrl) setDiag('restUrl', info.restUrl);
    if (info.wssUrl) setDiag('wssUrl', info.wssUrl);
    if (info.latencyMs !== undefined) {
      setDiag('latency', Number.isFinite(info.latencyMs) ? `${info.latencyMs} ms` : '-- ms');
    }
    if (info.httpStatus !== undefined) {
      setDiag('httpStatus', info.httpStatus ? String(info.httpStatus) : 'Sin respuesta');
    }
    if (info.wsReconnects !== undefined) setDiag('wsReconnects', String(info.wsReconnects ?? 0));
    if (info.lastWsMessage !== undefined) {
      setDiag('lastWsMessage', info.lastWsMessage ? String(info.lastWsMessage) : 'Ninguno');
    }
  },

  /**
   * Exclusión mutua atómica: exactamente UNA sola vista visible a la vez.
   */
  setView: (viewName) => {
    const viewMap = {
      auth: document.getElementById('authView'),
      guest: document.getElementById('guestView'),
      'user-vehicles': document.getElementById('userVehiclesView'),
      lobby: document.getElementById('lobbyView'),
      mando: document.getElementById('mandoView'),
      monitor: document.getElementById('monitorView'),
      admin: document.getElementById('adminView'),
    };

    ALL_VIEWS.forEach((key) => {
      const el = viewMap[key];
      if (!el) return;
      const active = key === viewName;
      el.classList.toggle('is-visible', active);
      el.hidden = !active;
    });

    const showMando = viewName === 'mando';
    const showLobby = viewName === 'lobby';
    document.body.classList.toggle('mando-mode', showMando);
    document.body.classList.toggle('mando-control', showMando);
    document.body.classList.toggle('app-view-control', showLobby || showMando);

    return viewName;
  },

  setMandoMode: (isActive) => UI.setView(isActive ? 'mando' : 'lobby'),

  setMonitorView: (isActive) => UI.setView(isActive ? 'monitor' : 'lobby'),

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
    const short = String(label).replace(/^VEHÍCULO\s*·?\s*/i, '').trim() || 'DETENIDO';
    document.querySelectorAll('[data-lobby="vehicleState"]').forEach((el) => {
      el.textContent = short;
      el.title = label;
    });
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

    const wrapper = document.createElement('div');
    wrapper.className = 'd-flex';
    const body = document.createElement('div');
    body.className = 'toast-body small text-white fw-semibold';
    body.textContent = String(message);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-close btn-close-white me-2 m-auto';
    closeBtn.dataset.bsDismiss = 'toast';
    closeBtn.setAttribute('aria-label', 'Cerrar');
    wrapper.append(body, closeBtn);
    toastEl.appendChild(wrapper);

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
      const value = String(d?.id_demo ?? d?.id ?? index + 1);
      const name = String(d.nombre || d.name || `Rutina #${value}`);
      const tipo = d.tipo ? `[${d.tipo}] ` : '';
      const desc = String(d.descripcion || 'Secuencia automática lista para ejecutar.');

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'demo-catalog-item';
      item.dataset.demoId = value;

      const top = document.createElement('div');
      top.className = 'demo-catalog-top';

      const title = document.createElement('strong');
      title.className = 'demo-catalog-name';
      title.textContent = `${tipo}${name}`;

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

  renderDemoSelect: (demos = []) => {
    const select = document.getElementById('demoSelect');
    if (!select) return;

    const list = Array.isArray(demos) ? demos : [];
    select.textContent = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = list.length > 0 ? 'Selecciona una rutina…' : 'Sin rutinas disponibles';
    select.appendChild(placeholder);

    list.forEach((d, index) => {
      const value = d?.id_demo ?? d?.id ?? index + 1;
      const name = d?.nombre || d?.name || `Rutina ${value}`;
      const tipo = d?.tipo ? ` (${d.tipo})` : '';
      const opt = document.createElement('option');
      opt.value = String(value);
      opt.textContent = `${name}${tipo}`;
      select.appendChild(opt);
    });

    if (list.length > 0) {
      const firstValue = list[0]?.id_demo ?? list[0]?.id ?? 1;
      select.value = String(firstValue);
    }

    document.querySelectorAll('[data-lobby="demoCount"]').forEach((el) => {
      el.textContent = String(list.length);
    });

    if (!select.dataset.boundSync) {
      select.addEventListener('change', () => UI.syncSelectedDemoCard(select.value));
      select.dataset.boundSync = 'true';
    }
    UI.syncSelectedDemoCard(select.value);
  },

  renderDemoError: (msg = 'No se pudo sincronizar el catálogo de rutinas.') => {
    const container = document.getElementById('demosListContainer');
    if (container) {
      container.textContent = '';
      const err = document.createElement('div');
      err.className = 'demo-empty demo-empty--error';
      err.textContent = msg;
      container.appendChild(err);
    }
  },

  demoTimelineStart: ({ name = 'Rutina', description = '' } = {}) => {
    const panel = document.getElementById('demoTimeline');
    const list = document.getElementById('demoTimelineList');
    const title = document.getElementById('demoTimelineTitle');
    const hint = document.getElementById('demoTimelineHint');
    const empty = document.getElementById('demoTimelineEmpty');
    if (!panel || !list) return;

    list.textContent = '';
    if (title) title.textContent = name;
    if (hint) hint.textContent = description || 'Esperando pasos del vehículo...';
    if (empty) {
      empty.hidden = false;
      empty.textContent = 'Esperando pasos del vehículo...';
    }
    panel.classList.remove('is-finished');
    panel.classList.add('is-live');
  },

  etiquetarCeldas: (tbody) => {
    if (!tbody) return;
    const encabezados = Array.from(tbody.closest('table')?.tHead?.rows[0]?.cells || []).map((th) =>
      th.textContent.trim()
    );
    tbody.querySelectorAll('tr').forEach((tr) => {
      Array.from(tr.cells).forEach((td, i) => {
        if (td.colSpan > 1) return;
        const texto = encabezados[i] || '';
        td.dataset.label = texto === 'Acciones' ? '' : texto;
      });
    });
  },

  demoTimelineIsLive: () => Boolean(document.getElementById('demoTimeline')?.classList.contains('is-live')),

  demoTimelineAddStep: (cmdIdOrInfo, extraOptions = {}) => {
    const panel = document.getElementById('demoTimeline');
    const list = document.getElementById('demoTimelineList');
    const empty = document.getElementById('demoTimelineEmpty');
    if (!panel || !list) return;

    if (!panel.classList.contains('is-live')) return;

    const isObj = cmdIdOrInfo !== null && typeof cmdIdOrInfo === 'object';
    const opts = isObj ? { ...cmdIdOrInfo, ...extraOptions } : extraOptions;
    const rawCmdId = isObj ? opts.cmdId ?? opts.codigo_fisico ?? opts.codigo ?? opts.id_comando : cmdIdOrInfo;
    const numId = rawCmdId !== null && rawCmdId !== undefined && rawCmdId !== '' ? Number(rawCmdId) : null;
    const cmdId = Number.isInteger(numId) ? numId : null;

    list.querySelectorAll('.demo-step.is-current').forEach((el) => {
      el.classList.remove('is-current');
      el.classList.add('is-past');
    });

    const meta = cmdId ? CONFIG.COMMAND_META[cmdId] : null;
    const li = document.createElement('li');
    li.className = 'demo-step is-current';

    const time = document.createElement('time');
    time.className = 'demo-step-time';
    let horaFormateada = '';
    if (opts.timestamp) {
      const iso = String(opts.timestamp).replace(' ', 'T');
      if (iso.length > 10) horaFormateada = iso.slice(11, 19);
    }
    time.textContent = horaFormateada || new Date().toLocaleTimeString('es-ES', { hour12: false });

    const name = document.createElement('span');
    name.className = 'demo-step-name';
    if (meta?.icon) {
      const ico = document.createElement('i');
      ico.className = `bi ${meta.icon} me-1`;
      name.appendChild(ico);
    }
    const labelTexto = opts.name || meta?.label || (cmdId ? `Comando ${cmdId}` : 'Movimiento');
    name.appendChild(document.createTextNode(labelTexto));

    if (opts.duracionMs && Number(opts.duracionMs) > 0) {
      const dur = document.createElement('small');
      dur.className = 'text-secondary ms-1';
      dur.textContent = `(${(Number(opts.duracionMs) / 1000).toFixed(1)}s)`;
      name.appendChild(dur);
    }

    const chip = document.createElement('span');
    chip.className = 'demo-step-id font-monospace';
    chip.textContent = cmdId ? `#${cmdId}` : opts.orden ? `Paso ${opts.orden}` : '•';

    li.append(time, name, chip);
    list.appendChild(li);
    while (list.children.length > 60) list.removeChild(list.firstElementChild);

    if (empty) empty.hidden = true;
    list.scrollTop = list.scrollHeight;
  },

  demoTimelineEnd: (text, tone = 'info') => {
    const panel = document.getElementById('demoTimeline');
    const list = document.getElementById('demoTimelineList');
    if (!panel || !list) return;

    list.querySelectorAll('.demo-step.is-current').forEach((el) => {
      el.classList.remove('is-current');
      el.classList.add('is-past');
    });

    const li = document.createElement('li');
    li.className = `demo-step demo-step--end demo-step--${tone}`;

    const time = document.createElement('time');
    time.className = 'demo-step-time';
    time.textContent = new Date().toLocaleTimeString('es-ES', { hour12: false });

    const label = document.createElement('span');
    label.className = 'demo-step-name';
    label.textContent = text;

    li.append(time, label);
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;

    panel.classList.remove('is-live');
    panel.classList.add('is-finished');
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

  setHardwareStatus: (conectado) => {
    const ids = ['controlHardwareBadge', 'monitorHardwareBadge', 'userWorkspaceHardwareBadge'];
    let texto = 'Hardware ESP8266: Sin verificar';
    let clase = 'badge text-bg-dark border border-secondary text-secondary';
    let lobbyTexto = 'Sin verificar';

    if (conectado === true || conectado === 1) {
      texto = 'Hardware ESP8266: En línea';
      clase = 'badge bg-success-subtle text-success border border-success-subtle';
      lobbyTexto = 'En línea';
    } else if (conectado === false || conectado === 0) {
      texto = 'Hardware ESP8266: Desconectado';
      clase = 'badge bg-secondary-subtle text-warning border border-warning-subtle';
      lobbyTexto = 'Desconectado';
    }

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = clase;
      el.textContent = texto;
    });

    const lobbyEl = document.getElementById('lobbyHardwareState');
    if (lobbyEl) {
      lobbyEl.textContent = lobbyTexto;
    }
  },

  setJoystickState: (state) => {
    const badge = UI.elements.joystickStateBadge;
    if (badge) {
      badge.textContent = state;
      badge.className = 'badge text-bg-secondary';
    }
  },

  /**
   * Cierra de forma segura cualquier modal de Bootstrap 5:
   * - Quita foco interno para evitar bloqueo aria-hidden en navegadores modernos.
   * - Si el modal estaba todavía en transición de apertura (_isTransitioning),
   *   reintenta el cierre en shown.bs.modal y aplica limpieza de respaldo de backdrop.
   */
  hideModal: (modalIdOrEl) => {
    const el =
      typeof modalIdOrEl === 'string' ? document.getElementById(modalIdOrEl) : modalIdOrEl;
    if (!el) return;

    if (document.activeElement && el.contains(document.activeElement)) {
      try {
        document.activeElement.blur();
      } catch (_) {}
    }

    const forceCleanup = () => {
      el.classList.remove('show');
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
      el.removeAttribute('aria-modal');
      el.removeAttribute('role');

      const anyOtherOpen = document.querySelector('.modal.show');
      if (!anyOtherOpen) {
        document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
      }
    };

    try {
      const inst = bootstrap.Modal.getOrCreateInstance(el);
      if (inst._isTransitioning) {
        el.addEventListener(
          'shown.bs.modal',
          () => {
            try {
              inst.hide();
            } catch (_) {
              forceCleanup();
            }
          },
          { once: true }
        );
      }
      inst.hide();
    } catch (_) {
      forceCleanup();
    }

    // Respaldo garantizado si Bootstrap no completó el cierre tras la transición
    setTimeout(() => {
      if (el.classList.contains('show') || el.style.display === 'block') {
        forceCleanup();
      }
    }, 380);
  },
};

export { UI };
export default UI;
