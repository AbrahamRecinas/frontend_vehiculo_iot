/**
 * app.js
 * Orquestador principal de la aplicación de control IoT.
 * Coordina WebSocket (WSS), API REST (FastAPI/AWS), joystick, UI y estado.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';
import { api } from './api.js';
import { wsService } from './ws.js';
import { JoystickController } from './joystick.js';
import { UI } from './ui.js';

// ---------------------------------------------------------------------------
// Referencias del DOM y controlador del joystick
// ---------------------------------------------------------------------------
let joystickController = null;

const getEl = (id) => document.getElementById(id);

function initJoystick() {
  joystickController = new JoystickController(
    getEl('joystickTrack'),
    getEl('joystickKnob'),
    {
      onDirection: (cmdId) => handleMovimiento(cmdId),
      onRelease: () => {
        detenerVehiculo();
      },
      onVisualChange: (info) => {
        actualizarGuiaVisual(info);
      },
      onLockChange: (controller) => {
        // FASE 4: exclusión mutua — sincroniza el controlador activo (STATE + window)
        STATE.activeController = controller;
        window.activeController = controller;
        UI.setControllerLock(controller);
      },
    }
  );
}

function actualizarGuiaVisual(info) {
  const guides = {
    [CONFIG.COMMANDS.AVANZAR]: getEl('joystickGuideN'),
    [CONFIG.COMMANDS.RETROCEDER]: getEl('joystickGuideS'),
    [CONFIG.COMMANDS.DIAGONAL_DERECHA]: getEl('joystickGuideE'),
    [CONFIG.COMMANDS.DIAGONAL_IZQUIERDA]: getEl('joystickGuideW'),
  };

  Object.values(guides).forEach((el) => {
    if (el) el.classList.remove('active');
  });

  const activeGuide = info?.latchedCommand ? guides[info.latchedCommand] : null;
  if (activeGuide) activeGuide.classList.add('active');
}

// ---------------------------------------------------------------------------
// ESTADO INTERNO DE LA APLICACIÓN
// ---------------------------------------------------------------------------
// Nota: movimientoInFlight se reasigna dinámicamente, por lo que no se congela.
const STATE = {
  vehicleId: CONFIG.VEHICLE_ID,
  lastSentCommand: CONFIG.COMMANDS.DETENER,
  movementInFlight: null, // Promise del último movimiento
  movementSequence: 0, // Ignora respuestas visuales de movimientos obsoletos
  apagarArmadoHasta: 0, // Ventana de confirmación del botón Apagar (timestamp ms)
  demoActive: false,
  busyCommands: new Set(),
  activeController: null, // 'joystick' | 'dpad' | null (FASE 4: exclusión mutua)
};

// Controlador activo global (expuesto en window para exclusión mutua Joystick <-> D-Pad)
window.activeController = null; // 'joystick' | 'dpad' | null

// IDs de movimiento de tracción / diagonal gestionados como movimiento continuo
const MOVIMIENTO_IDS = [
  CONFIG.COMMANDS.AVANZAR,
  CONFIG.COMMANDS.RETROCEDER,
  CONFIG.COMMANDS.DIAGONAL_DERECHA,
  CONFIG.COMMANDS.DIAGONAL_IZQUIERDA,
];

// ---------------------------------------------------------------------------
// GESTIÓN DE COMANDOS DE MOVIMIENTO / DEMO
// ---------------------------------------------------------------------------
async function handleMovimiento(idComando) {
  const cmdId = Number(idComando);
  const isSafetyStop = cmdId === CONFIG.COMMANDS.DETENER;

  if (isSafetyStop) {
    await detenerVehiculo();
    return;
  }

  const isMovementCmd = MOVIMIENTO_IDS.includes(cmdId);

  if (STATE.busyCommands.has(cmdId)) {
    return false; // Evitar repeticiones de comando sin procesar
  }

  const sequence = ++STATE.movementSequence;
  STATE.busyCommands.add(cmdId);

  // Con lógica de Toggle: el arrastre del joystick envía UNO SOLO y el
  // lanzamiento envía el paro global (12). Este método solo gestiona el flujo.
  let res;
  if (isMovementCmd) {
    const request = api.enviarMovimiento(cmdId);
    STATE.movementInFlight = request;
    try {
      res = await request;
    } catch (_) {
      res = { ok: false, status: 0, data: null, latencyMs: 0, error: 'Error al solicitar movimiento' };
    } finally {
      if (STATE.movementInFlight === request) STATE.movementInFlight = null;
    }
  } else {
    res = await api.enviarMovimiento(cmdId);
  }

  STATE.busyCommands.delete(cmdId);

  // Una respuesta antigua no debe sobrescribir el comando más reciente ni el paro.
  if (isMovementCmd && sequence !== STATE.movementSequence) return false;

  if (res.ok) {
    STATE.lastSentCommand = cmdId;

    if (cmdId !== CONFIG.COMMANDS.DEMO_FABRICA) {
      const commandLabel = CONFIG.COMMAND_META[cmdId]?.label || `CMD ${cmdId}`;
      UI.setCommandState(cmdId, `VEHÍCULO · ${commandLabel.toUpperCase()}`);
    }

    UI.setPulseState(
      cmdId === CONFIG.COMMANDS.DEMO_FABRICA ? 'active-demo' : 'active-moving'
    );
    return true;
  }

  UI.showToast(`No se pudo enviar el comando ${cmdId}: ${res.error}`, 'danger');
  if (STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER) {
    await detenerVehiculo();
  }
  return false;
}

/**
 * Detención del vehículo con serialización ante el movimiento en vuelo.
 * Al soltar el joystick manda obligatoriamente el POST con el ID 12.
 */
async function detenerVehiculo() {
  // Invalida respuestas visuales antiguas antes de serializar el paro.
  STATE.movementSequence += 1;

  // Esperar a que finalice el movimiento en curso (máx 5s) para no enviar
  // el paro antes que el arranque (race condition crítico con lógica toggle).
  if (STATE.movementInFlight) {
    try {
      await STATE.movementInFlight;
    } catch (_) {
      // Ignorar error previo; igualmente se procede al paro
    }
  }

  await enviarParo(CONFIG.COMMANDS.DETENER);
}

async function enviarParo(comandoId) {
  const res = await api.enviarMovimiento(comandoId, { keepalive: true, timeoutMs: 4000 });

  if (res.ok) {
    STATE.lastSentCommand = Number(comandoId);
    UI.setCommandState(comandoId, 'VEHÍCULO DETENIDO');
    UI.setPulseState('active-stopped');

    return true;
  }

  // Reintento único para paro de emergencia (comando idempotente por diseño)
  return new Promise((resolve) => {
    setTimeout(async () => {
      const retryRes = await api.enviarMovimiento(comandoId, { keepalive: true, timeoutMs: 4000 });
      resolve(retryRes.ok);
    }, 600);
  });
}

// ---------------------------------------------------------------------------
// DEMO: INICIAR Y CANCELAR
// ---------------------------------------------------------------------------
async function iniciarDemo() {
  const select = document.getElementById('demoSelect');
  const idDemo = select ? Number(select.value) : NaN;

  if (!idDemo) {
    UI.showToast('Selecciona primero una demo disponible', 'warning');
    return;
  }

  UI.setActionButtonBusy('btnIniciarDemo', true);
  const res = await api.iniciarDemo(idDemo);

  UI.setActionButtonBusy('btnIniciarDemo', false);

  if (res.ok) {
    STATE.demoActive = true;
    STATE.lastSentCommand = Number(idDemo);
    UI.setDemoStatus(true);
    UI.setCommandState(Number(idDemo), `EJECUTANDO DEMO (${idDemo})`);
    UI.setPulseState('active-demo');
    UI.showToast(`Demo #${idDemo} iniciada correctamente`, 'warning');
  } else {
    UI.setDemoStatus(false);
    UI.showToast(`Error al iniciar demo: ${res.error}`, 'danger');
    await detenerVehiculo();
  }
}

async function cancelarDemo() {
  UI.setActionButtonBusy('btnCancelarDemo', true);
  const res = await api.cancelarDemo();

  UI.setActionButtonBusy('btnCancelarDemo', false);

  if (res.ok) {
    STATE.demoActive = false;
    UI.setDemoStatus(false);
    UI.setCommandState(CONFIG.COMMANDS.DETENER, 'VEHÍCULO DETENIDO');
    UI.setPulseState('active-stopped');
    UI.showToast('Demo Fábrica cancelada', 'info');

    // Seguridad adicional: parar emergencia tras cancelar demo
    await enviarParo(12);
  } else {
    UI.showToast(`Error al cancelar demo: ${res.error}`, 'danger');
    // El paro de seguridad se envía igualmente aunque falle la cancelación
    await enviarParo(12);
  }
}

function mapWssState(wsState, detail = '') {
  if (wsState === 'open') {
    return { state: 'online', detail: detail || 'En línea · Operativo' };
  }
  if (wsState === 'connecting') {
    return { state: 'connecting', detail: detail || 'Conectando...' };
  }
  return { state: 'offline', detail: detail || 'Sin conexión' };
}

function syncDiagnostics(extra = {}) {
  const metrics = wsService.getMetrics();
  UI.updateDiagnostics({
    restUrl: CONFIG.BASE_URL,
    wssUrl: CONFIG.WSS_URL,
    wsReconnects: metrics.attempts,
    lastWsMessage: metrics.lastMessage,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// WSS: EVENTOS
// ---------------------------------------------------------------------------
function bindWebSocketEvents() {
  wsService.on('statusChange', ({ state, detail }) => {
    if (state === 'open') {
      UI.setWssOnline(detail || 'En línea · Operativo');
    } else {
      UI.setConnectivity({
        wss: mapWssState(state, detail),
      });
    }
    syncDiagnostics();

    // Fail-safe: si el canal WSS se cae mientras hay un movimiento en curso, frenar por REST
    if ((state === 'closed' || state === 'error') && STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER) {
      const lastWasMovement = Object.values(CONFIG.COMMANDS).includes(STATE.lastSentCommand) && STATE.lastSentCommand < CONFIG.COMMANDS.DEMO_FABRICA;
      if (lastWasMovement) {
        detenerVehiculo();
      }
    }

    // Sincronizar badge del estado del joystick
    UI.setJoystickState(state === 'open' ? 'Conectado' : state === 'connecting' ? 'Conectando' : 'Offline');
  });

  wsService.on('fin_demo', (payload) => {
    STATE.demoActive = false;
    UI.setDemoStatus(false);
    UI.setCommandState(CONFIG.COMMANDS.DETENER, 'VEHÍCULO DETENIDO');
    UI.setPulseState('active-stopped');
    syncDiagnostics();
    UI.showToast(`Demo finalizada por el vehículo (${payload?.timestamp || 'evento'})`, 'info');
  });

  wsService.on('command_echo', (idComando) => {
    const cmdId = Number(idComando);
    STATE.lastSentCommand = cmdId;
    syncDiagnostics();

    if (cmdId === CONFIG.COMMANDS.DETENER) {
      UI.setCommandState(cmdId, 'VEHÍCULO DETENIDO');
      UI.setPulseState('active-stopped');
      return;
    }

    const label = CONFIG.COMMAND_META[cmdId]?.label || `CMD ${cmdId}`;
    UI.setCommandState(cmdId, `VEHÍCULO · ${label.toUpperCase()}`);
    UI.setPulseState(cmdId === CONFIG.COMMANDS.DEMO_FABRICA ? 'active-demo' : 'active-moving');
  });

  wsService.on('message', (payload) => {
    syncDiagnostics();
    console.debug('[WS] Telemetría:', payload);
  });
}

// ---------------------------------------------------------------------------
// POLLING DE SALUD DE LA API
// ---------------------------------------------------------------------------
async function actualizarSaludApi({ showToast = false } = {}) {
  const health = await api.comprobarSaludApi();
  const status = health.ok ? 'online' : 'offline';

  UI.setConnectivity({
    wss: mapWssState(wsService.getState(), UI.connectivityState?.wss?.detail),
    aws: {
      state: status,
      detail: status === 'online' ? `Operativo · ${health.latencyMs} ms` : `No alcanzable: ${health.error || 'Desconocido'}`,
      latencyMs: health.latencyMs,
      httpStatus: health.status,
      error: health.error,
    },
    rds: { state: 'unverified', detail: 'Sin verificar' },
  });

  syncDiagnostics({
    latencyMs: health.latencyMs,
    httpStatus: health.status ? `HTTP ${health.status}` : (health.error || 'Sin respuesta'),
  });

  if (showToast) {
    UI.showToast(
      `Enlace AWS: ${health.ok ? `OK · ${health.latencyMs} ms` : `Fallo (${health.error || 'sin respuesta'})`}`,
      health.ok ? 'success' : 'danger'
    );
  }

  return health;
}

async function iniciarSaludPolling() {
  await actualizarSaludApi();

  setInterval(async () => {
    if (document.visibilityState === 'visible') {
      await actualizarSaludApi();
    }
  }, CONFIG.TIMING.HEALTH_POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// FASE 1: FLUJO LOBBY <-> MODO MANDO
// ---------------------------------------------------------------------------
async function entrarAModoMando() {
  // Cambio de vista inmediato: no depende de que fullscreen u orientación se resuelvan
  STATE.activeController = null;
  window.activeController = null;
  UI.setControllerLock(null);
  UI.setMandoMode(true);

  // Pantalla completa y orientación se solicitan sin bloquear la vista
  const docEl = document.documentElement;
  const lockLandscape = () => {
    try {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (_) { /* Orientación lock no soportada (ej. iOS Safari) */ }
  };

  try {
    if (typeof docEl.requestFullscreen === 'function' && !document.fullscreenElement) {
      Promise.resolve(docEl.requestFullscreen()).catch(() => {}).then(lockLandscape);
    } else {
      lockLandscape();
    }
  } catch (_) { /* Fullscreen no disponible o denegado por el usuario */ }
}

function salirDeModoMando() {
  try {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => {});
    }
  } catch (_) { /* noop */ }

  try {
    if (screen.orientation && typeof screen.orientation.unlock === 'function') {
      screen.orientation.unlock();
    }
  } catch (_) { /* noop */ }

  STATE.activeController = null;
  window.activeController = null;
  UI.setControllerLock(null);
  UI.setMandoMode(false);
}

// ---------------------------------------------------------------------------
// INICIALIZACIÓN GLOBAL
// ---------------------------------------------------------------------------
async function boot() {
  UI.init();

  // FASE 1: Lobby en dispositivos táctiles; Modo Mando directo solo con ratón/trackpad.
  // No se usa el ancho del viewport: un móvil en horizontal también puede superar 768px.
  const esPC = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (esPC) {
    UI.setMandoMode(true);
  } else {
    UI.setMandoMode(false);
  }

  // Si el navegador sale de pantalla completa (gesto del sistema o tecla Esc),
  // en móvil se regresa al lobby para evitar ver el mando recortado
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement || esPC) return;
    if (!document.body.classList.contains('mando-control')) return;
    salirDeModoMando();
  });

  getEl('btnEmergencyStop').addEventListener('click', async (e) => {
    e.preventDefault();
    if (joystickController) joystickController.forceRelease();
    STATE.activeController = null;
    window.activeController = null;
    UI.setControllerLock(null);
    UI.setStopButtonState(true);

    // Si hay una rutina autónoma en curso, DETENER también la cancela en el backend
    if (STATE.demoActive) {
      UI.showToast('Cancelando rutina autónoma y deteniendo...', 'warning');
      await cancelarDemo();
    } else {
      UI.showToast('Enviando paro de emergencia (CMD 12)...', 'warning');
      await detenerVehiculo();
    }
    UI.setStopButtonState(false);
  });

  getEl('btnEnterMando').addEventListener('click', async () => {
    await entrarAModoMando();
  });

  getEl('btnExitMando').addEventListener('click', () => {
    salirDeModoMando();
  });

  getEl('btnIniciarDemo').addEventListener('click', iniciarDemo);
  getEl('btnCancelarDemo').addEventListener('click', cancelarDemo);

  const diagPanel = getEl('diagPanel');
  const btnToggleDiag = getEl('btnToggleDiag');
  if (diagPanel && btnToggleDiag) {
    diagPanel.addEventListener('shown.bs.collapse', () => {
      btnToggleDiag.setAttribute('aria-expanded', 'true');
      syncDiagnostics();
    });
    diagPanel.addEventListener('hidden.bs.collapse', () => {
      btnToggleDiag.setAttribute('aria-expanded', 'false');
    });
  }

  getEl('btnRunDiag').addEventListener('click', async () => {
    UI.showToast('Ejecutando diagnóstico de enlace...', 'info');
    await actualizarSaludApi({ showToast: true });
  });

  getEl('btnCloseDiag').addEventListener('click', () => {
    bootstrap.Collapse.getOrCreateInstance(getEl('diagPanel')).hide();
  });

  getEl('btnToggleDiag').addEventListener('click', () => {
    syncDiagnostics();
    bootstrap.Collapse.getOrCreateInstance(getEl('diagPanel')).toggle();
  });

  // Comando de acción disparado sobre un botón (click o cruceta D-Pad)
  const ejecutarComandoBoton = async (btn) => {
      const cmdId = Number(btn.dataset.cmd);

      if (cmdId === CONFIG.COMMANDS.DEMO_FABRICA) {
        await iniciarDemo();
        return;
      }

      if (cmdId === CONFIG.COMMANDS.DETENER) {
        await detenerVehiculo();
        return;
      }

      if (MOVIMIENTO_IDS.includes(cmdId)) {
        await handleMovimiento(cmdId);
        return;
      }

      // Comandos de pulso (9, 10, 13, 14): solo envían el fetch al presionarse, sin iluminación
      if (
        cmdId === CONFIG.COMMANDS.LUCES ||
        cmdId === CONFIG.COMMANDS.SONIDO ||
        cmdId === CONFIG.COMMANDS.ENCENDER ||
        cmdId === CONFIG.COMMANDS.APAGAR
      ) {
        // Confirmación dentro de la app (sin diálogos nativos que saquen de pantalla completa):
        // el primer toque arma Apagar y el segundo, dentro de 3 s, lo envía
        if (cmdId === CONFIG.COMMANDS.APAGAR) {
          const now = Date.now();
          if (now > STATE.apagarArmadoHasta) {
            STATE.apagarArmadoHasta = now + 3000;
            UI.showToast('Pulsa Apagar otra vez en 3 s para confirmar', 'warning');
            return;
          }
          STATE.apagarArmadoHasta = 0;
        }
        if (STATE.busyCommands.has(cmdId)) return;
        STATE.busyCommands.add(cmdId);

        const resPulse = await api.enviarMovimiento(cmdId);
        STATE.busyCommands.delete(cmdId);

        if (!resPulse.ok) {
          UI.showToast(`Fallo envío comando ${cmdId}: ${resPulse.error}`, 'danger');
          if (STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER) {
            await detenerVehiculo();
          }
        }
        return;
      }

      // Mecanismos de la cruceta (3, 4, 5, 6): envían al presionar; el DETENER llega al soltar
      if (cmdId === CONFIG.COMMANDS.ALZAR_PALA || cmdId === CONFIG.COMMANDS.BAJAR_PALA ||
          cmdId === CONFIG.COMMANDS.GIRAR_DERECHA || cmdId === CONFIG.COMMANDS.GIRAR_IZQUIERDA) {
        await handleMovimiento(cmdId);
        return;
      }

      // Comandos auxiliares restantes con debounce de seguridad
      if (STATE.busyCommands.has(cmdId)) return;
      STATE.busyCommands.add(cmdId);

      const res = await api.enviarMovimiento(cmdId);
      STATE.busyCommands.delete(cmdId);

      UI.setActionButtonActive(btn.id, false); // Reset visual tras confirmación

      if (res.ok) {
        UI.setActionButtonActive(btn.id, true); // Estado optimista de acción completada
        setTimeout(() => UI.setActionButtonActive(btn.id, false), 1800); // Revertir flash visual
      } else {
        UI.showToast(`Fallo envío comando ${cmdId}: ${res.error}`, 'danger');
        if (STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER) {
          await detenerVehiculo();
        }
      }
  };

  // Botones de acción secundaria por data-cmd
  document.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      // La cruceta D-Pad gestiona su propio ciclo via pointer events (press = accion, release = DETENER)
      const dpadGrid = document.getElementById('dpadGrid');
      if (dpadGrid && dpadGrid.contains(btn)) return;
      // FASE 4: exclusión mutua — el joystick tiene prioridad sobre la cruceta D-Pad
      if (dpadGrid && STATE.activeController === 'joystick') {
        return;
      }
      await ejecutarComandoBoton(btn);
    });
  });

  // FASE 2/4: eventos táctiles de la Cruceta D-Pad (grid de 4 botones)
  const dpadGrid = document.getElementById('dpadGrid');
  if (dpadGrid) {
    dpadGrid.addEventListener('pointerdown', async (e) => {
      // FASE 4: exclusión mutua — el joystick tiene prioridad sobre la cruceta D-Pad
      if (STATE.activeController === 'joystick') return;
      const target = e.target;
      const btn = target && typeof target.closest === 'function' ? target.closest('[data-cmd]') : null;
      if (!btn) return;
      STATE.activeController = 'dpad';
      window.activeController = 'dpad';
      UI.setControllerLock(STATE.activeController);
      // FASE 3/4: ejecutar el mecanismo (pala/rotacion) al presionar (sin toggle; el release envia DETENER)
      await ejecutarComandoBoton(btn);
    });

    const handleDpadRelease = () => {
      // FASE 4: al soltar la cruceta se envía inmediatamente el DETENER (CMD 12)
      if (STATE.activeController !== 'dpad') return;
      STATE.activeController = null;
      window.activeController = null;
      UI.setControllerLock(null);
      detenerVehiculo();
    };

    dpadGrid.addEventListener('pointerup', handleDpadRelease);
    dpadGrid.addEventListener('pointercancel', handleDpadRelease);
    window.addEventListener('pointerup', handleDpadRelease);
    window.addEventListener('pointercancel', handleDpadRelease);
    window.addEventListener('blur', handleDpadRelease);
  }

  // Año dinámico en el footer
  if (getEl('currentYear')) {
    getEl('currentYear').textContent = String(new Date().getFullYear());
  }

  // Arrancar servicios
  bindWebSocketEvents();
  initJoystick();
  wsService.connect();

  // Carga inicial del catálogo de demos (informativo) en paralelo al polling de salud
  const demoLoadPromise = cargarCatalogoDemos();
  await iniciarSaludPolling();
  await demoLoadPromise;
}

async function cargarCatalogoDemos() {
  const res = await api.obtenerDemos();

  if (res.ok) {
    const demos = res.data?.demos || res.data || [];
    UI.renderDemos(demos);
    UI.renderDemoSelect(demos);
  } else {
    UI.renderDemoError();
  }
}

// Punto de entrada: inicialización bajo flag para debug
if (document.getElementById('mainContent')) {
  boot().catch((err) => {
    console.error('[BOOT] Error crítico en inicialización:', err);
    UI.showToast(`Error de arranque: ${err.message}`, 'danger');
  });
}
