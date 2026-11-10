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
      onDirection: (cmdId) => {
        handleMovimiento(cmdId);
      },
      onRelease: () => {
        detenerVehiculo();
      },
      onVisualChange: (info) => {
        actualizarGuiaVisual(info);
      },
      onLockChange: (controller) => {
        // FASE 4: exclusión mutua — sincroniza el controlador activo
        STATE.activeController = controller;
        UI.setControllerLock(controller);
      },
    }
  );
}

function actualizarGuiaVisual(info) {
  const guides = {
    1: getEl('joystickGuideN'),
    2: getEl('joystickGuideS'),
    3: getEl('joystickGuideE'),
    4: getEl('joystickGuideW'),
  };

  // Resetear clases activas
  Object.values(guides).forEach((el) => {
    if (el) el.classList.remove('active');
  });

  if (info && info.latchedCommand) {
    const key = info.latchedCommand === CONFIG.COMMANDS.AVANZAR ? 'N'
      : info.latchedCommand === CONFIG.COMMANDS.RETROCEDER ? 'S'
      : info.latchedCommand === CONFIG.COMMANDS.DIAGONAL_DERECHA ? 'E'
      : 'W';
    const el = guides[key];
    if (el) el.classList.add('active');
  }
}

// ---------------------------------------------------------------------------
// ESTADO INTERNO DE LA APLICACIÓN
// ---------------------------------------------------------------------------
// Nota: movimientoInFlight se reasigna dinámicamente, por lo que no se congela.
const STATE = {
  vehicleId: CONFIG.VEHICLE_ID,
  lastSentCommand: CONFIG.COMMANDS.DETENER,
  movementInFlight: null, // Promise del último movimiento
  demoActive: false,
  busyCommands: new Set(),
  toggleActive: new Set(), // IDs de botones (5-8) actualmente activos
  activeController: null, // 'joystick' | 'dpad' | null (FASE 4: exclusión mutua)
};

// IDs de la cruceta D-Pad que gestiona el grupo de mecanismos (comandos 5, 6, 3 y 4)
const MECANISMOS_IDS = [
  CONFIG.COMMANDS.ALZAR_PALA,
  CONFIG.COMMANDS.BAJAR_PALA,
  CONFIG.COMMANDS.GIRAR_IZQUIERDA,
  CONFIG.COMMANDS.GIRAR_DERECHA,
];

// IDs de movimiento de tracción / diagonal gestionados como movimiento continuo
const MOVIMIENTO_IDS = [
  CONFIG.COMMANDS.AVANZAR,
  CONFIG.COMMANDS.RETROCEDER,
  CONFIG.COMMANDS.DIAGONAL_DERECHA,
  CONFIG.COMMANDS.DIAGONAL_IZQUIERA,
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
    return; // Evitar repeticiones de comando sin procesar
  }

  STATE.busyCommands.add(cmdId);

  // Con lógica de Toggle: el arrastre del joystick envía UNO SOLO y el
  // lanzamiento envía el paro global (12). Este método solo gestiona el flujo.
  let res;
  if (isMovementCmd) {
    STATE.movementInFlight = api.enviarMovimiento(cmdId);
    try {
      res = await STATE.movementInFlight;
    } catch (_) {
      res = { ok: false, status: 0, data: null, latencyMs: 0, error: 'Error al solicitar movimiento' };
    } finally {
      STATE.movementInFlight = null;
    }
  } else {
    res = await api.enviarMovimiento(cmdId);
  }

  STATE.busyCommands.delete(cmdId);

  if (res.ok) {
    STATE.lastSentCommand = cmdId;

    if (cmdId !== CONFIG.COMMANDS.DEMO_FABRICA) {
      UI.setCommandState(
        cmdId,
        `VEHÍCULO MODO (${CONFIG.COMMANDS[cmdId]?.label || `CMD ${cmdId}`})`
      );
    }

    UI.setPulseState(
      cmdId === CONFIG.COMMANDS.DEMO_FABRICA ? 'active-demo' : 'active-moving'
    );
  } else {
    UI.showToast(`No se pudo enviar el comando ${cmdId}: ${res.error}`, 'danger');
    if (STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER) {
      await detenerVehiculo();
    }
  }
}

/**
 * Detención del vehículo con serialización ante el movimiento en vuelo.
 * Al soltar el joystick manda obligatoriamente el POST con el ID 12.
 */
async function detenerVehiculo() {
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

    // Al detener (CMD 12), se limpian los estados activos de los comandos de toggle (5-8)
    STATE.toggleActive.clear();
    ['btnPalaSubir', 'btnPalaBajar', 'btnGirarDer', 'btnGirarIzq'].forEach((id) => {
      UI.setActionButtonActive(id, false);
    });

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
/**
 * Maneja comandos de toggle exclusivo (5, 6, 7, 8).
 * - Activa/desactiva visualmente el botón presionado.
 * - Al activar, envía el ID. Al desactivar (toggle off), reenvía el mismo ID.
 * - Solo un mecanismo del grupo puede estar activo a la vez.
 */
async function handleToggleCommand(btn, cmdId) {
  if (STATE.busyCommands.has(cmdId)) return;
  STATE.busyCommands.add(cmdId);

  // Si otro mecanismo del grupo está activo, quitar activo al anterior
  if (STATE.toggleActive.size > 0) {
    for (const activeId of Array.from(STATE.toggleActive)) {
      if (activeId !== btn.id) {
        UI.setActionButtonActive(activeId, false);
        STATE.toggleActive.delete(activeId);
      }
    }
  }

  const currentlyActive = STATE.toggleActive.has(btn.id);

  // Si el botón presionado está encendido: toggle OFF (reenviar el mismo ID para detener)
  if (currentlyActive) {
    STATE.toggleActive.delete(btn.id);
    UI.setActionButtonActive(btn.id, false);

    const res = await api.enviarMovimiento(cmdId);

    if (res.ok) {
      if (STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER) {
        await detenerVehiculo();
      }
    } else {
      UI.showToast(`Fallo envío comando ${cmdId}: ${res.error}`, 'danger');
      if (STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER) {
        await detenerVehiculo();
      }
    }

    STATE.busyCommands.delete(cmdId);
    return;
  }

  // Activar: enviar el comando y mantener el estado visual activo
  STATE.toggleActive.add(btn.id);
  UI.setActionButtonActive(btn.id, true);

  const res = await api.enviarMovimiento(cmdId);

  STATE.busyCommands.delete(cmdId);

  if (res.ok) {
    STATE.lastSentCommand = Number(cmdId);
  } else {
    STATE.toggleActive.delete(btn.id);
    UI.setActionButtonActive(btn.id, false);
    UI.showToast(`Fallo envío comando ${cmdId}: ${res.error}`, 'danger');
    if (STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER) {
      await detenerVehiculo();
    }
  }
}

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
  }
}

// ---------------------------------------------------------------------------
// WSS: EVENTOS
// ---------------------------------------------------------------------------
function bindWebSocketEvents() {
  wsService.on('statusChange', ({ state, detail, attempts }) => {
    // Actualizar semáforos de UI
    if (state === 'open') {
      // Estado explícito de conexión exitosa: WSS en línea / Operativo
      UI.setWssOnline('En línea · Operativo');
    } else {
      UI.setConnectivity({
        wss: { state: state === 'error' ? 'offline' : 'connecting', detail: detail || 'Sin estado' },
        aws: { state: 'online', detail: 'Operativo', latencyMs: 0 }, // Reemplazado por polling
        rds: { state: 'unverified', detail: 'Sin verificar' },
      });
    }

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
    UI.showToast(`Demo finalizada por el vehículo (${payload?.timestamp || 'evento'})`, 'info');
  });

  wsService.on('command_echo', (idComando) => {
    STATE.lastSentCommand = Number(idComando);
    UI.setCommandState(idComando, `VEHÍCULO MODO (CMD ${idComando})`);
    UI.setPulseState(Number(idComando) === CONFIG.COMMANDS.DEMO_FABRICA ? 'active-demo' : 'active-moving');
  });

  wsService.on('message', (payload) => {
    // Mensaje libre de la red de telemetría
    console.debug('[WS] Telemetría:', payload);
  });
}

// ---------------------------------------------------------------------------
// POLLING DE SALUD DE LA API
// ---------------------------------------------------------------------------
async function iniciarSaludPolling() {
  const check = async () => {
    const health = await api.comprobarSaludApi();
    const status = health.ok ? 'online' : 'offline';

    UI.setConnectivity({
      wss: { state: wsService.getState() === 'open' ? 'online' : 'connecting', detail: wsService.getState() },
      aws: { state: status, detail: status === 'online' ? 'Operativo' : `No alcanzable: ${health.error || 'Desconocido'}`, latencyMs: health.latencyMs },
      rds: { state: 'unverified', detail: 'Sin verificar' },
    });
  };

  await check();

  setInterval(async () => {
    if (document.visibilityState === 'visible') {
      await check();
    }
  }, CONFIG.TIMING.HEALTH_POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// FASE 1: FLUJO LOBBY <-> MODO MANDO
// ---------------------------------------------------------------------------
async function entrarAModoMando() {
  // Play: pantalla completa + orientación landscape en móvil
  try {
    if (typeof document.documentElement.requestFullscreen === 'function') {
      await document.documentElement.requestFullscreen();
    }
  } catch (_) { /* Fullscreen no disponible o denegado por el usuario */ }

  try {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      await screen.orientation.lock('landscape');
    }
  } catch (_) { /* Orientación lock no soportada (ej. iOS Safari) */ }

  STATE.activeController = null;
  UI.setMandoMode(true);
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
  UI.setMandoMode(false);
}

// ---------------------------------------------------------------------------
// INICIALIZACIÓN GLOBAL
// ---------------------------------------------------------------------------
async function boot() {
  UI.init();

  // FASE 1: flujo inicial — Lobby en móvil, Modo Mando directo en PC
  const esPC = window.matchMedia && window.matchMedia('(min-width: 768px)').matches;
  if (esPC) {
    UI.setMandoMode(true);
  } else {
    UI.setMandoMode(false);
  }

  getEl('btnEmergencyStop').addEventListener('click', async (e) => {
    e.preventDefault();
    UI.setStopButtonState(true);
    UI.showToast('Enviando paro de emergencia (CMD 12)...', 'warning');
    await detenerVehiculo();
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

  getEl('btnRunDiag').addEventListener('click', async () => {
    UI.showToast('Ejecutando diagnóstico de enlace...', 'info');
    const health = await api.comprobarSaludApi();
    UI.setConnectivity({
      wss: { state: wsService.getState() === 'open' ? 'online' : 'connecting', detail: wsService.getState() },
      aws: { state: health.ok ? 'online' : 'offline', detail: health.ok ? 'Operativo' : (health.error || 'Desconocido'), latencyMs: health.latencyMs },
      rds: { state: 'unverified', detail: 'Sin verificar' },
    });
    UI.showToast(`API check: ${health.ok ? `OK · ${health.latencyMs}ms` : `FAIL (${health.error})`}`, health.ok ? 'success' : 'danger');
  });

  getEl('btnCloseDiag').addEventListener('click', () => {
    UI.setConnectivity({
      wss: { state: wsService.getState() === 'open' ? 'online' : 'connecting', detail: wsService.getState() },
      aws: { state: 'online', detail: 'Operativo', latencyMs: 0 },
      rds: { state: 'unverified', detail: 'Sin verificar' },
    });
    // Ocultar con Bootstrap Collapse
    bootstrap.Collapse.getOrCreateInstance(getEl('diagPanel')).hide();
  });

  getEl('btnToggleDiag').addEventListener('click', () => {
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

      // Comandos de toggle exclusivo (mecanismos: 5, 6, 3 y 4)
      if (MECANISMOS_IDS.includes(cmdId)) {
        await handleToggleCommand(btn, cmdId);
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
      // FASE 4: exclusión mutua — el joystick tiene prioridad sobre la cruceta D-Pad
      const dpadGrid = document.getElementById('dpadGrid');
      if (dpadGrid && dpadGrid.contains(btn) && STATE.activeController === 'joystick') {
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
      UI.setControllerLock(STATE.activeController);
      // FASE 3/4: ejecutar el mecanismo (pala/rotacion) directamente al presionar
      await ejecutarComandoBoton(btn);
    });

    const handleDpadRelease = () => {
      // FASE 4: al soltar la cruceta se envía inmediatamente el DETENER (CMD 12)
      if (STATE.activeController !== 'dpad') return;
      STATE.activeController = null;
      UI.setControllerLock(null);
      detenerVehiculo();
    };

    dpadGrid.addEventListener('pointerup', handleDpadRelease);
    dpadGrid.addEventListener('pointercancel', handleDpadRelease);
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
    // Limpiar el indicador de carga persistido en el DOM
    const container = document.getElementById('demosListContainer');
    if (container) container.innerHTML = '';
    UI.renderDemoSelect(demos);
  } else {
    // Estado visual de error: se detiene el indicador de carga en el UI
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
