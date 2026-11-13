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
import { UI } from './ui.js?v=2.1';

// ---------------------------------------------------------------------------
// Referencias del DOM y controlador del joystick
// ---------------------------------------------------------------------------
let joystickController = null;

// Estado del Modo Mando (control) usado por la navegación para volver a la vista previa
let mandoActivo = false;
// Modo de Control preferido por el usuario (se restaura al volver de Monitoreo)
let modoControlPreferido = false;
// Vista activa actual ('control' | 'monitor') para evitar colisiones entre eventos
let vistaActual = 'control';

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
  demos: [], // Catálogo cargado desde GET /demos (nombre y descripción de la cronología)
  apagarArmadoHasta: 0, // Ventana de confirmación del botón Apagar (timestamp ms)
  demoActive: false,
  busyCommands: new Set(),
  activeController: null, // 'joystick' | 'dpad' | null (FASE 4: exclusión mutua)
  monitorHistorial: [], // Últimos movimientos individuales persistidos (máx. 10) del panel de Monitoreo
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
    return true; // Ya hay un envío idéntico en vuelo: no es un fallo
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
  if (isMovementCmd && sequence !== STATE.movementSequence) return true; // Respuesta superada por otro comando

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
function armarBotonApagar(btn, armado) {
  btn.classList.toggle('is-armed', armado);
  const label = btn.querySelector('.action-name');
  if (label) label.textContent = armado ? 'Confirmar' : 'Apagar';
}

async function iniciarDemo() {
  const select = document.getElementById('demoSelect');
  const idDemo = select ? Number(select.value) : NaN;

  if (!idDemo) {
    UI.showToast('Selecciona primero una demo disponible', 'warning');
    return;
  }

  const demo = STATE.demos.find((d) => String(d?.id_demo ?? d?.id ?? d?.id_comando ?? d?.demo_id ?? d?.uuid) === String(idDemo));
  UI.demoTimelineStart({
    name: demo?.nombre || demo?.name || `Rutina #${idDemo}`,
    description: demo?.descripcion ? `Secuencia de referencia: ${demo.descripcion}` : '',
  });

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
    UI.demoTimelineEnd('La rutina no pudo iniciarse', 'error');
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
    UI.demoTimelineEnd('Rutina cancelada desde la app', 'info');

    // Seguridad adicional: parar emergencia tras cancelar demo
    await enviarParo(12);
  } else {
    UI.showToast(`Error al cancelar demo: ${res.error}`, 'danger');
    // El paro de seguridad se envía igualmente aunque falle la cancelación
    await enviarParo(12);
  }
}

// ---------------------------------------------------------------------------
// FASE MONITOREO: CARGA INICIAL (REST) + EVENTOS WSS EN TIEMPO REAL
// Contratos:
//  - GET  /api/vehiculos/{id}/estado      -> estado actual del vehículo
//  - GET  /api/vehiculos/{id}/historial   -> últimos movimientos individuales persistidos
//  - GET  /api/vehiculos/{id}/comandos    -> catálogo de comandos soportados por el vehículo
//  - WSS  {"evento":"ESTADO_INICIAL",...}   -> estado actual (actualiza tarjeta, no tabla)
//  - WSS  {"evento":"MOVIMIENTO_DEMO",...}  -> demo en curso (actualiza tarjeta, NO tabla)
//  - WSS  {"tipo":"MOVIMIENTO_INDIVIDUAL",...} -> movimiento persistido (tarjeta + tabla)
// ---------------------------------------------------------------------------
const MONITOREO_MAX_REGISTROS = 10;

function extraerFechaHora(timestamp) {
  const iso = String(timestamp || '').replace(' ', 'T');
  const fecha = iso.length >= 10 ? iso.slice(0, 10) : '';
  const hora = iso.length > 10 ? iso.slice(11, 19) : '';
  return { fecha, hora };
}

/**
 * Normaliza un movimiento desde cualquier fuente (historial REST / WSS).
 * @param {{ idRegistro?: number|null, idComando?: number|null, comando?: string|null, fecha?: string, hora?: string, timestamp?: string }} fuente
 * @returns {{ idRegistro: number|null, idComando: number|null, comando: string, fecha: string, hora: string, timestamp: string|null }}
 */
function crearMovimiento({ idRegistro = null, idComando = null, comando = null, fecha = '', hora = '', timestamp = null } = {}) {
  const nIdRegistro = (idRegistro === null || idRegistro === undefined) ? null : Number(idRegistro);
  const nIdComando = (idComando === null || idComando === undefined) ? null : Number(idComando);
  const meta = Number.isInteger(nIdComando) ? CONFIG.COMMAND_META?.[nIdComando] : null;
  const nComando = String(
    comando ||
    (meta?.label ? meta.label : (nIdComando ? `CMD ${nIdComando}` : (nIdRegistro ? `Registro #${nIdRegistro}` : 'Movimiento')))
  );
  const { fecha: parsedFecha, hora: parsedHora } = extraerFechaHora(timestamp);
  const nFecha = String(fecha || parsedFecha);
  const nHora = String(hora || parsedHora);

  return {
    idRegistro: nIdRegistro,
    idComando: nIdComando,
    comando: nComando,
    fecha: nFecha,
    hora: nHora,
    timestamp: timestamp || null,
  };
}

/** Convierte la respuesta GET /historial a la lista de movimientos (máx. 10). */
function aHistorial(data) {
  const entries = data?.historial;
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, MONITOREO_MAX_REGISTROS).map((entry) => {
    const rawTimestamp = entry?.fecha_hora || entry?.timestamp || null;
    const { fecha, hora } = extraerFechaHora(rawTimestamp);
    const idComando = entry?.codigo ?? entry?.id_comando ?? null;
    const nId = idComando !== null && idComando !== undefined ? Number(idComando) : null;
    const comandoNombre = entry?.comando ?? entry?.nombre_comando ?? (nId ? CONFIG.COMMAND_META?.[nId]?.label : null);

    return crearMovimiento({
      idRegistro: entry?.id_historial ?? entry?.id_registro ?? null,
      idComando: Number.isInteger(nId) ? nId : null,
      comando: comandoNombre,
      fecha: entry?.fecha || fecha,
      hora: entry?.hora || hora,
      timestamp: rawTimestamp,
    });
  });
}

/** Normaliza el payload del evento WSS {"evento":"ESTADO_INICIAL", ...} o GET /estado. */
function aEstadoInicial(payload = {}) {
  const estadoObj = Array.isArray(payload?.estado)
    ? payload.estado[0]
    : (payload?.estado || (Array.isArray(payload) ? payload[0] : payload) || {});

  const idComando = estadoObj?.id_comando ?? estadoObj?.codigo;
  const nIdComando = idComando !== null && idComando !== undefined ? Number(idComando) : null;
  const comando = String(
    estadoObj?.comando ||
    estadoObj?.nombre ||
    (Number.isInteger(nIdComando) ? (CONFIG.COMMAND_META?.[nIdComando]?.label || `CMD ${nIdComando}`) : 'Desconocido')
  );
  const rawTimestamp = payload?.timestamp || estadoObj?.fecha_actualizacion || estadoObj?.fecha_hora || null;
  const { fecha, hora } = extraerFechaHora(rawTimestamp);

  return crearMovimiento({
    idRegistro: estadoObj?.id_historial ?? estadoObj?.id_registro ?? null,
    idComando: Number.isInteger(nIdComando) ? nIdComando : null,
    comando,
    fecha: estadoObj?.fecha || fecha,
    hora: estadoObj?.hora || hora,
    timestamp: rawTimestamp,
  });
}

/** Normaliza el payload WSS {"tipo":"MOVIMIENTO_INDIVIDUAL", ...} -> SÍ persiste en tabla. */
function aMovimientoIndividual(payload = {}) {
  const idComando = payload?.id_comando ?? payload?.codigo;
  const nIdComando = idComando !== null && idComando !== undefined ? Number(idComando) : null;
  const comando = String(
    payload?.comando ||
    (Number.isInteger(nIdComando) ? (CONFIG.COMMAND_META?.[nIdComando]?.label || `CMD ${nIdComando}`) : payload?.nombre_comando || 'Movimiento')
  );
  const rawTimestamp = payload?.timestamp || payload?.fecha_hora || null;
  const { fecha, hora } = extraerFechaHora(rawTimestamp);

  return crearMovimiento({
    idRegistro: payload?.id_historial ?? payload?.id_registro ?? null,
    idComando: Number.isInteger(nIdComando) ? nIdComando : null,
    comando,
    fecha: payload?.fecha || fecha,
    hora: payload?.hora || hora,
    timestamp: rawTimestamp,
  });
}

// Mapeo semántico de nombres textuales de comandos a sus identificadores oficiales
const COMMAND_NAME_ALIASES = Object.freeze({
  'AVANZAR': 1,
  'ADELANTE': 1,
  'FORWARD': 1,
  'RETROCEDER': 2,
  'ATRAS': 2,
  'ATRÁS': 2,
  'BACKWARD': 2,
  'GIRAR_DERECHA': 3,
  'GIRAR DERECHA': 3,
  'DERECHA': 3,
  'RIGHT': 3,
  'GIRAR_IZQUIERDA': 4,
  'GIRAR IZQUIERDA': 4,
  'IZQUIERDA': 4,
  'LEFT': 4,
  'SUBIR_EXCAVADORA': 5,
  'SUBIR EXCAVADORA': 5,
  'ALZAR_PALA': 5,
  'ALZAR PALA': 5,
  'PALA_ARRIBA': 5,
  'BAJAR_EXCAVADORA': 6,
  'BAJAR EXCAVADORA': 6,
  'BAJAR_PALA': 6,
  'BAJAR PALA': 6,
  'PALA_ABAJO': 6,
  'AVANZAR_DERECHA': 7,
  'AVANZAR DERECHA': 7,
  'DIAGONAL_DERECHA': 7,
  'DIAGONAL DERECHA': 7,
  'AVANZAR_IZQUIERDA': 8,
  'AVANZAR IZQUIERDA': 8,
  'DIAGONAL_IZQUIERDA': 8,
  'DIAGONAL IZQUIERDA': 8,
  'LUCES': 9,
  'LUZ': 9,
  'LIGHTS': 9,
  'SONIDO': 10,
  'CLAXON': 10,
  'HORN': 10,
  'SOUND': 10,
  'DEMO_FABRICA': 11,
  'DEMO FABRICA': 11,
  'DEMO': 11,
  'DETENER': 12,
  'PARO': 12,
  'STOP': 12,
  'ENCENDER': 13,
  'START': 13,
  'APAGAR': 14,
  'OFF': 14,
});

/**
 * Resuelve el ID numérico de un comando desde cualquier estructura de payload
 * (soporta id_comando, codigo, cmdId, o resolución por nombre textual).
 */
function resolverIdComando(payload) {
  if (typeof payload === 'number') return Number.isInteger(payload) ? payload : null;
  if (!payload || typeof payload !== 'object') return null;

  const directId = payload?.id_comando ?? payload?.codigo ?? payload?.idComando ?? payload?.cmdId;
  if (directId !== undefined && directId !== null && directId !== '') {
    const num = Number(directId);
    if (Number.isInteger(num)) return num;
  }

  const raw = String(payload?.comando || payload?.nombre || payload?.nombre_comando || '').trim().toUpperCase();
  if (raw && COMMAND_NAME_ALIASES[raw]) {
    return COMMAND_NAME_ALIASES[raw];
  }

  return null;
}

/** Normaliza el payload WSS {"evento":"MOVIMIENTO_DEMO", ...} -> NO persiste en tabla. */
function aMovimientoDemo(payload = {}) {
  const rawTimestamp = payload?.timestamp || payload?.fecha_hora || null;
  const { fecha, hora } = extraerFechaHora(rawTimestamp);
  const idComando = resolverIdComando(payload);
  const meta = idComando ? CONFIG.COMMAND_META?.[idComando] : null;
  const comando = String(payload?.comando || payload?.nombre_comando || meta?.label || 'Demo');
  return crearMovimiento({
    idComando: Number.isInteger(idComando) ? idComando : null,
    comando,
    fecha,
    hora,
    timestamp: rawTimestamp,
  });
}

/**
 * Renderiza la tarjeta destacada del último movimiento.
 * - mov === null  -> Estado visual "Cargando"
 * - sin idComando -> Estado visual "Sin movimientos"
 */
function renderUltimoMovimiento(mov) {
  const commandEl = document.getElementById('monitorLastCommand');
  const metaEl = document.getElementById('monitorLastMeta');
  const fechaEl = document.getElementById('monitorLastFecha');
  const horaEl = document.getElementById('monitorLastHora');
  const statusEl = document.getElementById('monitorLastMovementStatus');

  if (!commandEl || !metaEl || !fechaEl || !horaEl || !statusEl) return;

  const paint = (comando, metaText, fecha, hora, statusText, statusTone, idComando) => {
    if (commandEl) {
      commandEl.textContent = '';
      const cmdMeta = idComando ? CONFIG.COMMAND_META?.[idComando] : null;
      if (cmdMeta?.icon) {
        const ico = document.createElement('i');
        ico.className = `bi ${cmdMeta.icon} me-1`;
        commandEl.appendChild(ico);
      }
      commandEl.appendChild(document.createTextNode(comando));
    }
    if (metaEl) metaEl.textContent = metaText;
    if (fechaEl) fechaEl.textContent = fecha;
    if (horaEl) horaEl.textContent = hora;
    if (statusEl) {
      statusEl.textContent = statusText;
      statusEl.className = 'badge ' + statusTone;
    }
  };

  if (!mov) {
    // Estado visual: "Cargando"
    paint('—', 'Consultando último movimiento…', '—', '—', 'Cargando', 'text-bg-secondary');
    return;
  }

  const esSinMovimientos = !mov.idComando && !mov.idRegistro;
  const esDetenido = mov.idComando === CONFIG.COMMANDS.DETENER || String(mov.comando).toLowerCase().includes('detener');

  if (esSinMovimientos) {
    // Estado visual: "Sin movimientos"
    paint('—', 'Sin movimientos registrados para el vehículo.', '—', '—', 'Sin movimientos', 'text-bg-secondary');
    return;
  }

  const metaText = mov.fecha
    ? `Último movimiento: ${mov.comando} · ${mov.fecha} ${mov.hora || ''}`.trim()
    : `Último movimiento: ${mov.comando} · CMD ${mov.idComando}`;

  paint(
    mov.comando,
    metaText,
    mov.fecha || '—',
    mov.hora || '—',
    esDetenido ? 'Vehículo Detenido' : 'Último Movimiento Registrado',
    esDetenido ? 'text-bg-danger' : 'text-bg-success',
    mov.idComando
  );
}

/**
 * Renderiza la tabla semántica de los últimos movimientos (máx. 10).
 * Columnas: #, Movimiento, Fecha, Hora.
 */
function renderHistorial(movimientos = [], emptyText = 'Sin movimientos registrados para el vehículo.') {
  const tbody = document.getElementById('monitorHistorialBody');
  const empty = document.getElementById('monitorHistorialEmpty');
  const countBadge = document.getElementById('monitorHistorialCount');

  if (!tbody) return;

  const movs = Array.isArray(movimientos) ? movimientos.slice(0, MONITOREO_MAX_REGISTROS) : [];

  tbody.textContent = '';

  if (movs.length === 0) {
    if (empty) {
      empty.hidden = false;
      let msgEl = empty.querySelector('.monitor-empty-text');
      if (!msgEl) {
        msgEl = document.createElement('span');
        msgEl.className = 'small text-secondary monitor-empty-text';
        empty.appendChild(msgEl);
      }
      msgEl.textContent = emptyText;
    }
    if (countBadge) countBadge.textContent = '0 movimientos';
    return;
  }

  if (empty) empty.hidden = true;
  if (countBadge) countBadge.textContent = `${movs.length} ${movs.length === 1 ? 'movimiento' : 'movimientos'}`;

  movs.forEach((mov, index) => {
    const tr = document.createElement('tr');

    const tdNumero = document.createElement('td');
    tdNumero.className = 'text-center';
    const badge = document.createElement('span');
    badge.className = 'badge text-bg-dark border border-secondary font-monospace';
    badge.textContent = `#${mov.idRegistro ?? mov.idComando ?? index + 1}`;
    tdNumero.appendChild(badge);

    const tdMovimiento = document.createElement('td');
    tdMovimiento.className = 'monitor-movimiento-cell';
    const meta = mov.idComando ? CONFIG.COMMAND_META?.[mov.idComando] : null;
    if (meta?.icon) {
      const ico = document.createElement('i');
      ico.className = `bi ${meta.icon} me-1`;
      tdMovimiento.appendChild(ico);
    }
    tdMovimiento.appendChild(document.createTextNode(mov.comando));

    const tdFecha = document.createElement('td');
    tdFecha.className = 'text-center font-monospace';
    tdFecha.textContent = mov.fecha || '—';

    const tdHora = document.createElement('td');
    tdHora.className = 'text-center font-monospace';
    tdHora.textContent = mov.hora || '—';

    tr.append(tdNumero, tdMovimiento, tdFecha, tdHora);
    tbody.appendChild(tr);
  });
}

/**
 * Renderiza el catálogo de comandos soportados por el vehículo desde GET /comandos.
 */
function renderComandosCatalogo(comandos = [], emptyText = 'Sin comandos disponibles.') {
  const tbody = document.getElementById('monitorComandosBody');
  const empty = document.getElementById('monitorComandosEmpty');
  const countBadge = document.getElementById('monitorComandosCount');

  if (!tbody) return;

  tbody.textContent = '';

  const lista = Array.isArray(comandos) ? comandos : [];

  if (lista.length === 0) {
    if (empty) {
      empty.hidden = false;
      let msgEl = empty.querySelector('.monitor-empty-text');
      if (!msgEl) {
        msgEl = document.createElement('span');
        msgEl.className = 'small text-secondary monitor-empty-text';
        empty.appendChild(msgEl);
      }
      msgEl.textContent = emptyText;
    }
    if (countBadge) countBadge.textContent = '0 comandos';
    return;
  }

  if (empty) empty.hidden = true;
  if (countBadge) countBadge.textContent = `${lista.length} comandos`;

  lista.forEach((cmd) => {
    const tr = document.createElement('tr');

    const tdNumero = document.createElement('td');
    tdNumero.className = 'text-center';
    const badge = document.createElement('span');
    badge.className = 'badge text-bg-dark border border-secondary font-monospace';
    const codigo = cmd?.codigo ?? cmd?.id_comando;
    badge.textContent = codigo ? `#${codigo}` : '—';
    tdNumero.appendChild(badge);

    const tdNombre = document.createElement('td');
    tdNombre.className = 'monitor-movimiento-cell';
    const meta = codigo ? CONFIG.COMMAND_META?.[codigo] : null;
    if (meta?.icon) {
      const ico = document.createElement('i');
      ico.className = `bi ${meta.icon} me-1`;
      tdNombre.appendChild(ico);
    }
    tdNombre.appendChild(document.createTextNode(cmd?.nombre || '—'));

    const tdDesc = document.createElement('td');
    tdDesc.className = 'text-secondary small';
    tdDesc.textContent = cmd?.descripcion || '—';

    const tdEstado = document.createElement('td');
    tdEstado.className = 'text-center';
    const activo = cmd?.activo === 1 || cmd?.activo === true;
    const badgeEstado = document.createElement('span');
    badgeEstado.className = activo
      ? 'badge bg-success-subtle text-success border border-success-subtle'
      : 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
    badgeEstado.textContent = activo ? 'Activo' : 'Inactivo';
    tdEstado.appendChild(badgeEstado);

    tr.append(tdNumero, tdNombre, tdDesc, tdEstado);
    tbody.appendChild(tr);
  });
}

/** Carga inicial del panel de Monitoreo: GET estado + GET historial + GET comandos (REST). */
async function cargarPanelMonitoreo() {
  // Estado visual inicial: "Cargando"
  renderUltimoMovimiento(null);
  renderHistorial([], 'Consultando historial de movimientos…');
  renderComandosCatalogo([], 'Consultando catálogo de comandos…');

  try {
    const [estadoRes, historialRes, comandosRes] = await Promise.all([
      api.obtenerEstado(),
      api.obtenerHistorial(),
      api.obtenerComandos(),
    ]);

    // 1. Catálogo de comandos soportados por el vehículo
    const comandos = Array.isArray(comandosRes?.data) ? comandosRes.data : [];
    renderComandosCatalogo(comandos);

    // 2. Historial de movimientos persistidos
    const historial = aHistorial(historialRes?.data);
    STATE.monitorHistorial = historial;
    renderHistorial(historial);

    // 3. Tarjeta destacada de último movimiento
    let ultimo = null;
    if (historial.length > 0) {
      ultimo = historial[0];
    } else if (estadoRes?.ok) {
      ultimo = aEstadoInicial({ estado: estadoRes.data, timestamp: null });
    }

    renderUltimoMovimiento(ultimo);
  } catch (err) {
    // Ante cualquier fallo de carga se muestra el estado honesto (nunca queda en "Cargando")
    console.error('[MONITOREO] Error al cargar panel de monitoreo:', err);
    renderUltimoMovimiento({
      idRegistro: null,
      idComando: null,
      comando: 'Sin movimientos registrados',
      fecha: '',
      hora: '',
      timestamp: null,
    });
    renderHistorial([], 'Sin movimientos disponibles por el momento.');
    renderComandosCatalogo([], 'No fue posible cargar el catálogo de comandos.');
  }
}

// ---------------------------------------------------------------------------
// NAVEGACIÓN PRINCIPAL: VISTA DE CONTROL <-> VISTA DE MONITOREO
// ---------------------------------------------------------------------------
function actualizarNavPills(vistaActiva) {
  const btnControl = document.getElementById('navBtnControl');
  const btnMonitor = document.getElementById('navBtnMonitor');
  if (btnControl && btnMonitor) {
    const esMonitor = vistaActiva === 'monitor';
    btnControl.classList.toggle('active', !esMonitor);
    btnControl.setAttribute('aria-selected', String(!esMonitor));
    btnMonitor.classList.toggle('active', esMonitor);
    btnMonitor.setAttribute('aria-selected', String(esMonitor));
  }
}

function bindViewNavigation() {
  document.querySelectorAll('[data-view-switch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const vista = btn.dataset.viewSwitch;
      if (vista === 'monitor') {
        entrarAMonitor();
      } else {
        salirDeMonitor();
      }
    });
  });

  const btnRefresh = document.getElementById('btnRefreshMonitor');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      cargarPanelMonitoreo();
    });
  }
}

async function entrarAMonitor() {
  vistaActual = 'monitor';
  // Ocultar mando y lobby de forma atómica y mostrar únicamente telemetría
  UI.setView('monitor');
  actualizarNavPills('monitor');
  await cargarPanelMonitoreo();
}

function salirDeMonitor() {
  vistaActual = 'control';
  actualizarNavPills('control');
  // Restaurar la vista de control previa (mando si estaba activo, o lobby en móvil)
  UI.setView(modoControlPreferido ? 'mando' : 'lobby');
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
    UI.demoTimelineEnd('Rutina finalizada por el vehículo', 'success');
  });

  // FASE MONITOREO: estado inicial entregado por WSS (no es un movimiento persistido)
  wsService.on('estado_inicial', (payload) => {
    const mov = aEstadoInicial(payload);
    renderUltimoMovimiento(mov);
    syncDiagnostics();
  });

  // FASE MONITOREO: movimiento individual persistido -> SÍ entra a la tabla de historial
  wsService.on('movimiento_individual', (payload) => {
    const mov = aMovimientoIndividual(payload);

    // Evitar duplicar el mismo registro exacto si ya existe por idRegistro o timestamp idéntico
    const duplicado = STATE.monitorHistorial.some(
      (m) =>
        (mov.idRegistro && m.idRegistro === mov.idRegistro) ||
        (mov.timestamp && m.timestamp && m.timestamp === mov.timestamp)
    );

    if (!duplicado) {
      STATE.monitorHistorial.unshift(mov);
      STATE.monitorHistorial = STATE.monitorHistorial.slice(0, MONITOREO_MAX_REGISTROS);
      renderHistorial(STATE.monitorHistorial);
    }

    // Actualiza la tarjeta destacada del último movimiento en tiempo real
    renderUltimoMovimiento(mov);
    syncDiagnostics();
  });

  // Evento de movimiento emitido durante la ejecución de una DEMO
  wsService.on('movimiento_demo', (payload) => {
    STATE.demoActive = true;
    UI.setDemoStatus(true);

    const cmdId = resolverIdComando(payload);
    const mov = aMovimientoDemo(payload);

    // 1. Añadir el paso inmediatamente a la cronología de movimientos de la demo
    UI.demoTimelineAddStep(cmdId, {
      name: mov.comando || payload?.comando || payload?.nombre_comando,
      cmdId: cmdId,
      orden: payload?.orden,
      duracionMs: payload?.duracion_ms,
      timestamp: payload?.timestamp || payload?.fecha_hora,
    });

    // 2. Actualizar el indicador de comando activo y pulso visual
    if (cmdId) {
      STATE.lastSentCommand = cmdId;
      const label = CONFIG.COMMAND_META[cmdId]?.label || mov.comando || `CMD ${cmdId}`;
      UI.setCommandState(cmdId, `DEMO · ${label.toUpperCase()}`);
      UI.setPulseState('active-demo');
    }

    // 3. Actualizar la tarjeta destacada en el panel de Monitoreo
    renderUltimoMovimiento(mov);
    syncDiagnostics();
  });

  wsService.on('command_echo', (idComando, payload) => {
    const cmdId = Number(idComando);
    STATE.lastSentCommand = cmdId;
    syncDiagnostics();

    // Solo añade a la cronología si no proviene de un evento MOVIMIENTO_DEMO ya procesado
    const ev = String(payload?.evento || payload?.tipo || '').toUpperCase();
    if (ev !== 'MOVIMIENTO_DEMO' && ev !== 'DEMO_MOVIMIENTO') {
      UI.demoTimelineAddStep(cmdId, {
        name: CONFIG.COMMAND_META[cmdId]?.label || `Comando ${cmdId}`,
        cmdId: cmdId,
      });
    }

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
  mandoActivo = true;
  modoControlPreferido = true;
  vistaActual = 'control';
  STATE.activeController = null;
  window.activeController = null;
  UI.setControllerLock(null);
  UI.setView('mando');

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
  mandoActivo = false;
  modoControlPreferido = false;
  // Solo volver al lobby si no estamos activamente en monitoreo
  if (vistaActual !== 'monitor') {
    UI.setView('lobby');
  }
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
    mandoActivo = true;
    modoControlPreferido = true;
    UI.setView('mando');
  } else {
    mandoActivo = false;
    modoControlPreferido = false;
    UI.setView('lobby');
  }

  // Si el navegador sale de pantalla completa (gesto del sistema o tecla Esc),
  // en móvil se regresa al lobby para evitar ver el mando recortado
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement || esPC) return;
    if (vistaActual === 'monitor') return; // Nunca sacar de monitoreo por salida de fullscreen
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

  getEl('btnLobbyCheck').addEventListener('click', async () => {
    await actualizarSaludApi({ showToast: true });
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
            armarBotonApagar(btn, true);
            UI.showToast('Pulsa Apagar otra vez en 3 s para confirmar', 'warning');
            setTimeout(() => {
              if (STATE.apagarArmadoHasta && Date.now() >= STATE.apagarArmadoHasta) {
                STATE.apagarArmadoHasta = 0;
                armarBotonApagar(btn, false);
              }
            }, 3000);
            return;
          }
          STATE.apagarArmadoHasta = 0;
          armarBotonApagar(btn, false);
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
  bindViewNavigation();
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
    STATE.demos = Array.isArray(demos) ? demos : [];
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
