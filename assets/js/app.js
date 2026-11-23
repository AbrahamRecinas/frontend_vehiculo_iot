/**
 * app.js
 * Orquestador principal de la aplicación IoT (4.1 Control + 4.2 Monitoreo + 4.3/4.4 B2B2C).
 * Coordina Auth JWT, WebSocket único (WSS), API REST, Joystick, Admin, Tienda (USUARIO) e Invitado.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';
import { auth } from './auth.js';
import { api, formatApiError } from './api.js';
import { wsService } from './ws.js';
import { JoystickController } from './joystick.js';
import { UI } from './ui.js?v=4.5';
import { initAdmin, alEntrarAdmin } from './admin.js?v=4.5';
import { initUserVehicles, cargarMisVehiculosModulo } from './user_vehicles.js?v=4.5';
import {
  initGuestModule,
  cargarCatalogoInvitado,
  iniciarTemporizadorInvitado,
  detenerTemporizadorInvitado,
  finalizarPruebaInvitado,
  applyGuestControlRestrictions,
  clearGuestControlRestrictions,
} from './guest.js?v=4.5';

let joystickController = null;
let mandoActivo = false;
let modoControlPreferido = false;
let vistaActual = 'auth';

const getEl = (id) => document.getElementById(id);
const MONITOREO_MAX_REGISTROS = 10;

const STATE = {
  vehicleId: null,
  vehicleInfo: null,
  comandosVehiculo: [],
  fisicoToComandoId: new Map(),
  lastSentCommand: CONFIG.COMMANDS.DETENER,
  movementInFlight: null,
  movementSequence: 0,
  demos: [],
  apagarArmadoHasta: 0,
  demoActive: false,
  busyCommands: new Set(),
  activeController: null,
  monitorHistorial: [],
  reconcileSeq: 0,
};

window.activeController = null;

const MOVIMIENTO_FISICO_IDS = [
  CONFIG.COMMANDS.AVANZAR,
  CONFIG.COMMANDS.RETROCEDER,
  CONFIG.COMMANDS.DIAGONAL_DERECHA,
  CONFIG.COMMANDS.DIAGONAL_IZQUIERDA,
];

function esUnidadBloqueadaParaAdmin(vehiculo) {
  if (!vehiculo || auth.getRole() !== 'ADMIN') return false;
  const esPropiedadCliente =
    vehiculo.estado_comercial === 'VENDIDO' ||
    (vehiculo.id_propietario !== null && vehiculo.id_propietario !== undefined);
  return esPropiedadCliente && !vehiculo.soporte_activo;
}

// ---------------------------------------------------------------------------
// RESOLUCIÓN DINÁMICA: codigo_fisico (hardware 1..14) -> id_comando real de la unidad
// ---------------------------------------------------------------------------
function reconstruirMapaComandos(comandos = []) {
  STATE.comandosVehiculo = Array.isArray(comandos) ? comandos : [];
  const mapa = new Map();
  STATE.comandosVehiculo.forEach((c) => {
    const activo = c.activo === 1 || c.activo === true;
    const cf = Number(c.codigo_fisico ?? c.codigo);
    const idCmd = Number(c.id_comando);
    const esBase = c.duracion_ms === null || c.duracion_ms === undefined;
    if (!activo || !Number.isInteger(cf) || !Number.isInteger(idCmd)) return;
    if (!mapa.has(cf) || esBase) {
      mapa.set(cf, idCmd);
    }
  });
  STATE.fisicoToComandoId = mapa;
  renderMovimientosTemporizadosControl();

  if (auth.getRole() === 'INVITADO') {
    applyGuestControlRestrictions(STATE.comandosVehiculo);
  } else {
    clearGuestControlRestrictions();
  }
}

function resolverIdComandoDesdeFisico(codigoFisico) {
  const cf = Number(codigoFisico);
  if (STATE.fisicoToComandoId.has(cf)) {
    return STATE.fisicoToComandoId.get(cf);
  }
  return cf;
}

function renderMovimientosTemporizadosControl() {
  const card = getEl('timedCommandsCard');
  const grid = getEl('timedCommandsGrid');
  if (!card || !grid) return;

  const temporizados = STATE.comandosVehiculo.filter(
    (c) => (c.activo === 1 || c.activo === true) && c.duracion_ms !== null && Number(c.duracion_ms) > 0
  );

  grid.textContent = '';
  if (!temporizados.length) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  temporizados.forEach((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-outline-info timed-cmd-btn';
    const meta = CONFIG.COMMAND_META[Number(c.codigo_fisico)] || null;
    if (meta?.icon) {
      const i = document.createElement('i');
      i.className = `bi ${meta.icon} me-1`;
      i.setAttribute('aria-hidden', 'true');
      btn.appendChild(i);
    }
    btn.appendChild(document.createTextNode(`${c.nombre} `));
    const badge = document.createElement('span');
    badge.className = 'badge text-bg-dark border border-info-subtle ms-1 font-monospace';
    badge.textContent = `${(Number(c.duracion_ms) / 1000).toFixed(1)}s`;
    btn.appendChild(badge);
    btn.addEventListener('click', () => ejecutarComandoPorId(c.id_comando, c));
    grid.appendChild(btn);
  });
}

// ---------------------------------------------------------------------------
// JOYSTICK
// ---------------------------------------------------------------------------
function initJoystick() {
  joystickController = new JoystickController(
    getEl('joystickTrack'),
    getEl('joystickKnob'),
    {
      onDirection: (codigoFisico) => handleMovimiento(codigoFisico),
      onRelease: () => detenerVehiculo(),
      onVisualChange: (info) => actualizarGuiaVisual(info),
      onLockChange: (controller) => {
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
// GESTIÓN DE COMANDOS DE MOVIMIENTO / DEMO
// ---------------------------------------------------------------------------
async function ejecutarComandoPorId(idComandoReal, cmdObj = null) {
  if (!STATE.vehicleId) {
    UI.showToast('Selecciona primero una unidad activa.', 'warning');
    return false;
  }
  const cmdId = Number(idComandoReal);
  const codigoFisico = Number(cmdObj?.codigo_fisico ?? cmdObj?.codigo ?? cmdId);

  if (codigoFisico === CONFIG.COMMANDS.DETENER) {
    await detenerVehiculo();
    return true;
  }

  if (STATE.busyCommands.has(cmdId)) return true;
  STATE.busyCommands.add(cmdId);
  const res = await api.enviarMovimiento(cmdId);
  STATE.busyCommands.delete(cmdId);

  if (res.ok) {
    STATE.lastSentCommand = codigoFisico;
    const label = cmdObj?.nombre || CONFIG.COMMAND_META[codigoFisico]?.label || `CMD ${cmdId}`;
    const sufijo = cmdObj?.duracion_ms ? ` (${(Number(cmdObj.duracion_ms) / 1000).toFixed(1)}s)` : '';
    UI.setCommandState(cmdId, `VEHÍCULO · ${label.toUpperCase()}${sufijo}`);
    UI.setPulseState('active-moving');
    return true;
  }

  UI.showToast(formatApiError(res, `No se pudo enviar el comando ${cmdId}`), 'danger');
  if (res.status !== 403 && res.status !== 401 && STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER) {
    await detenerVehiculo();
  }
  return false;
}

async function handleMovimiento(codigoFisicoInput) {
  const codigoFisico = Number(codigoFisicoInput);
  if (codigoFisico === CONFIG.COMMANDS.DETENER) {
    await detenerVehiculo();
    return true;
  }

  if (!STATE.vehicleId) {
    UI.showToast('No hay una unidad activa seleccionada.', 'warning');
    return false;
  }

  // En modo invitado, bloquear localmente comandos no permitidos antes del POST
  if (auth.getRole() === 'INVITADO' && !STATE.fisicoToComandoId.has(codigoFisico)) {
    UI.showToast('Esta acción está restringida en el modo de prueba para invitados.', 'warning');
    return false;
  }

  const idComandoReal = resolverIdComandoDesdeFisico(codigoFisico);
  const isMovementCmd = MOVIMIENTO_FISICO_IDS.includes(codigoFisico);

  if (STATE.busyCommands.has(idComandoReal)) {
    return true;
  }

  const sequence = ++STATE.movementSequence;
  STATE.busyCommands.add(idComandoReal);

  let res;
  if (isMovementCmd) {
    const request = api.enviarMovimiento(idComandoReal);
    STATE.movementInFlight = request;
    try {
      res = await request;
    } catch (_) {
      res = { ok: false, status: 0, data: null, latencyMs: 0, error: 'Error al solicitar movimiento' };
    } finally {
      if (STATE.movementInFlight === request) STATE.movementInFlight = null;
    }
  } else {
    res = await api.enviarMovimiento(idComandoReal);
  }

  STATE.busyCommands.delete(idComandoReal);

  if (isMovementCmd && sequence !== STATE.movementSequence) return true;

  if (res.ok) {
    STATE.lastSentCommand = codigoFisico;
    if (codigoFisico !== CONFIG.COMMANDS.DEMO_FABRICA) {
      const commandLabel = CONFIG.COMMAND_META[codigoFisico]?.label || `CMD ${codigoFisico}`;
      UI.setCommandState(idComandoReal, `VEHÍCULO · ${commandLabel.toUpperCase()}`);
    }
    UI.setPulseState(codigoFisico === CONFIG.COMMANDS.DEMO_FABRICA ? 'active-demo' : 'active-moving');
    return true;
  }

  UI.showToast(formatApiError(res, `No se pudo enviar el comando ${codigoFisico}`), 'danger');
  if (res.status !== 403 && res.status !== 401 && STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER) {
    await detenerVehiculo();
  }
  return false;
}

async function detenerVehiculo() {
  if (!STATE.vehicleId) return;
  STATE.movementSequence += 1;

  if (STATE.movementInFlight) {
    try {
      await STATE.movementInFlight;
    } catch (_) {}
  }

  const idDetener = resolverIdComandoDesdeFisico(CONFIG.COMMANDS.DETENER);
  await enviarParo(idDetener);
}

async function enviarParo(idComandoDetener) {
  if (!STATE.vehicleId) return false;
  const res = await api.enviarMovimiento(idComandoDetener, { keepalive: true, timeoutMs: 5000 });
  if (res.ok) {
    STATE.lastSentCommand = CONFIG.COMMANDS.DETENER;
    UI.setCommandState(idComandoDetener, 'VEHÍCULO DETENIDO');
    UI.setPulseState('active-stopped');
    return true;
  }

  if (res.status === 401 || res.status === 403) return false;

  return new Promise((resolve) => {
    setTimeout(async () => {
      const retryRes = await api.enviarMovimiento(idComandoDetener, {
        keepalive: true,
        timeoutMs: 5000,
      });
      resolve(retryRes.ok);
    }, 600);
  });
}

function armarBotonApagar(btn, armado) {
  btn.classList.toggle('is-armed', armado);
  const label = btn.querySelector('.action-name');
  if (label) label.textContent = armado ? 'Confirmar' : 'Apagar';
}

async function iniciarDemo(explicitIdDemo = null) {
  if (!STATE.vehicleId) return;
  const select = getEl('demoSelect');
  const idDemo = explicitIdDemo !== null ? Number(explicitIdDemo) : select ? Number(select.value) : NaN;
  if (!idDemo) {
    UI.showToast('Selecciona primero una demo disponible', 'warning');
    return;
  }

  const demo = STATE.demos.find((d) => String(d?.id_demo ?? d?.id) === String(idDemo));
  UI.demoTimelineStart({
    name: demo?.nombre || `Rutina #${idDemo}`,
    description: demo?.descripcion ? `Secuencia: ${demo.descripcion}` : '',
  });

  UI.setActionButtonBusy('btnIniciarDemo', true);
  const res = await api.iniciarDemo(idDemo);
  UI.setActionButtonBusy('btnIniciarDemo', false);

  if (res.ok) {
    STATE.demoActive = true;
    UI.setDemoStatus(true);
    UI.setCommandState(idDemo, `EJECUTANDO DEMO (${idDemo})`);
    UI.setPulseState('active-demo');
    UI.showToast(`Demo #${idDemo} iniciada correctamente`, 'warning');
  } else {
    UI.setDemoStatus(false);
    UI.showToast(formatApiError(res, 'Error al iniciar demo'), 'danger');
    UI.demoTimelineEnd('La rutina no pudo iniciarse', 'error');
    if (res.status !== 403 && res.status !== 401) {
      await detenerVehiculo();
    }
  }
}

async function cancelarDemo() {
  if (!STATE.vehicleId) return;
  UI.setActionButtonBusy('btnCancelarDemo', true);
  const res = await api.cancelarDemo();
  UI.setActionButtonBusy('btnCancelarDemo', false);

  const idDetener = resolverIdComandoDesdeFisico(CONFIG.COMMANDS.DETENER);
  if (res.ok) {
    STATE.demoActive = false;
    UI.setDemoStatus(false);
    UI.setCommandState(idDetener, 'VEHÍCULO DETENIDO');
    UI.setPulseState('active-stopped');
    UI.showToast('Demo cancelada y hardware detenido', 'info');
    UI.demoTimelineEnd('Rutina cancelada desde la app', 'info');
    await enviarParo(idDetener);
  } else {
    UI.showToast(formatApiError(res, 'Error al cancelar demo'), 'danger');
    if (res.status !== 403 && res.status !== 401) {
      await enviarParo(idDetener);
    }
  }
}

// ---------------------------------------------------------------------------
// MONITOREO (4.2 conservado intacto: máx. 10 individuales + aviso explícito 403/retry)
// ---------------------------------------------------------------------------
function extraerFechaHora(timestamp) {
  const iso = String(timestamp || '').replace(' ', 'T');
  const fecha = iso.length >= 10 ? iso.slice(0, 10) : '';
  const hora = iso.length > 10 ? iso.slice(11, 19) : '';
  return { fecha, hora };
}

function crearMovimiento({
  idRegistro = null,
  idComando = null,
  codigoFisico = null,
  comando = null,
  duracionMs = null,
  fecha = '',
  hora = '',
  timestamp = null,
} = {}) {
  const nIdRegistro = idRegistro === null || idRegistro === undefined ? null : Number(idRegistro);
  const nIdComando = idComando === null || idComando === undefined ? null : Number(idComando);
  const nFisico = codigoFisico !== null && codigoFisico !== undefined ? Number(codigoFisico) : nIdComando;
  const meta = Number.isInteger(nFisico) ? CONFIG.COMMAND_META?.[nFisico] : null;
  const baseLabel = String(
    comando || (meta?.label ? meta.label : nIdComando ? `CMD ${nIdComando}` : 'Movimiento')
  );
  const nDur = duracionMs !== null && duracionMs !== undefined && Number(duracionMs) > 0 ? Number(duracionMs) : null;
  const nComando = nDur ? `${baseLabel} (${(nDur / 1000).toFixed(1)}s)` : baseLabel;
  const { fecha: parsedFecha, hora: parsedHora } = extraerFechaHora(timestamp);

  return {
    idRegistro: nIdRegistro,
    idComando: nIdComando,
    codigoFisico: Number.isInteger(nFisico) ? nFisico : null,
    comando: nComando,
    duracionMs: nDur,
    fecha: String(fecha || parsedFecha),
    hora: String(hora || parsedHora),
    timestamp: timestamp || null,
  };
}

function aHistorial(data) {
  const entries = data?.historial;
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, MONITOREO_MAX_REGISTROS).map((entry) => {
    const rawTimestamp = entry?.fecha_hora || entry?.timestamp || null;
    const { fecha, hora } = extraerFechaHora(rawTimestamp);
    const codigoFisico = entry?.codigo_fisico ?? entry?.codigo ?? entry?.id_comando ?? null;
    const idComando = entry?.codigo ?? entry?.id_comando ?? null;
    return crearMovimiento({
      idRegistro: entry?.id_historial ?? entry?.id_registro ?? null,
      idComando: idComando !== null ? Number(idComando) : null,
      codigoFisico: codigoFisico !== null ? Number(codigoFisico) : null,
      comando: entry?.comando ?? entry?.nombre_comando ?? null,
      duracionMs: entry?.duracion_ms ?? null,
      fecha: entry?.fecha || fecha,
      hora: entry?.hora || hora,
      timestamp: rawTimestamp,
    });
  });
}

function aEstadoInicial(payload = {}) {
  const estadoObj = Array.isArray(payload?.estado)
    ? payload.estado[0]
    : payload?.estado || (Array.isArray(payload) ? payload[0] : payload) || {};

  const codigoFisico = estadoObj?.codigo_fisico ?? estadoObj?.codigo ?? estadoObj?.id_comando ?? null;
  const idComando = estadoObj?.id_comando ?? estadoObj?.codigo ?? null;
  const rawTimestamp = payload?.timestamp || estadoObj?.fecha_actualizacion || estadoObj?.fecha_hora || null;
  const { fecha, hora } = extraerFechaHora(rawTimestamp);

  return crearMovimiento({
    idRegistro: estadoObj?.id_historial ?? null,
    idComando: idComando !== null ? Number(idComando) : null,
    codigoFisico: codigoFisico !== null ? Number(codigoFisico) : null,
    comando: estadoObj?.comando || estadoObj?.nombre || null,
    duracionMs: estadoObj?.duracion_ms ?? null,
    fecha: estadoObj?.fecha || fecha,
    hora: estadoObj?.hora || hora,
    timestamp: rawTimestamp,
  });
}

function aMovimientoIndividual(payload = {}) {
  const codigoFisico = payload?.codigo_fisico ?? payload?.codigo ?? payload?.id_comando ?? null;
  const idComando = payload?.id_comando ?? payload?.codigo ?? null;
  const rawTimestamp = payload?.timestamp || payload?.fecha_hora || null;
  const { fecha, hora } = extraerFechaHora(rawTimestamp);

  return crearMovimiento({
    idRegistro: payload?.id_historial ?? null,
    idComando: idComando !== null ? Number(idComando) : null,
    codigoFisico: codigoFisico !== null ? Number(codigoFisico) : null,
    comando: payload?.comando || payload?.nombre_comando || null,
    duracionMs: payload?.duracion_ms ?? null,
    fecha: payload?.fecha || fecha,
    hora: payload?.hora || hora,
    timestamp: rawTimestamp,
  });
}

function aMovimientoDemo(payload = {}) {
  const rawTimestamp = payload?.timestamp || payload?.fecha_hora || null;
  const { fecha, hora } = extraerFechaHora(rawTimestamp);
  const codigoFisico = payload?.codigo_fisico ?? payload?.codigo ?? payload?.id_comando ?? null;
  return crearMovimiento({
    idComando: payload?.id_comando !== undefined ? Number(payload.id_comando) : null,
    codigoFisico: codigoFisico !== null ? Number(codigoFisico) : null,
    comando: payload?.comando || payload?.nombre_comando || 'Demo',
    duracionMs: payload?.duracion_ms ?? null,
    fecha,
    hora,
    timestamp: rawTimestamp,
  });
}

function renderUltimoMovimiento(mov) {
  const commandEl = getEl('monitorLastCommand');
  const metaEl = getEl('monitorLastMeta');
  const fechaEl = getEl('monitorLastFecha');
  const horaEl = getEl('monitorLastHora');
  const statusEl = getEl('monitorLastMovementStatus');
  if (!commandEl || !metaEl || !fechaEl || !horaEl || !statusEl) return;

  const paint = (comando, metaText, fecha, hora, statusText, statusTone, codigoFisico) => {
    commandEl.textContent = '';
    const cmdMeta = codigoFisico ? CONFIG.COMMAND_META?.[codigoFisico] : null;
    if (cmdMeta?.icon) {
      const ico = document.createElement('i');
      ico.className = `bi ${cmdMeta.icon} me-1`;
      commandEl.appendChild(ico);
    }
    commandEl.appendChild(document.createTextNode(comando));
    metaEl.textContent = metaText;
    fechaEl.textContent = fecha;
    horaEl.textContent = hora;
    statusEl.textContent = statusText;
    statusEl.className = 'badge ' + statusTone;
  };

  if (!mov) {
    paint('—', 'Consultando último movimiento…', '—', '—', 'Cargando', 'text-bg-secondary', null);
    return;
  }

  const esSinMovimientos = !mov.idComando && !mov.idRegistro && !mov.codigoFisico;
  if (esSinMovimientos) {
    paint(
      '—',
      mov.comando || 'Sin movimientos registrados para el vehículo.',
      '—',
      '—',
      'Sin movimientos',
      'text-bg-secondary',
      null
    );
    return;
  }

  const esDetenido =
    mov.codigoFisico === CONFIG.COMMANDS.DETENER ||
    String(mov.comando).toLowerCase().includes('detener');

  const metaText = mov.fecha
    ? `Último movimiento: ${mov.comando} · ${mov.fecha} ${mov.hora || ''}`.trim()
    : `Último movimiento: ${mov.comando}`;

  paint(
    mov.comando,
    metaText,
    mov.fecha || '—',
    mov.hora || '—',
    esDetenido ? 'Vehículo Detenido' : 'Último Movimiento Registrado',
    esDetenido ? 'text-bg-danger' : 'text-bg-success',
    mov.codigoFisico
  );
}

function renderHistorial(movimientos = [], emptyText = 'Sin movimientos registrados para el vehículo.') {
  const tbody = getEl('monitorHistorialBody');
  const empty = getEl('monitorHistorialEmpty');
  const countBadge = getEl('monitorHistorialCount');
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
    const meta = mov.codigoFisico ? CONFIG.COMMAND_META?.[mov.codigoFisico] : null;
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
  UI.etiquetarCeldas(tbody);
}

function renderComandosCatalogo(comandos = [], emptyText = 'Sin comandos disponibles.') {
  const tbody = getEl('monitorComandosBody');
  const empty = getEl('monitorComandosEmpty');
  const countBadge = getEl('monitorComandosCount');
  if (!tbody) return;

  tbody.textContent = '';
  const list = Array.isArray(comandos) ? comandos : [];
  if (list.length === 0) {
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
  if (countBadge) countBadge.textContent = `${list.length} comandos`;

  list.forEach((cmd) => {
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
    const cf = cmd?.codigo_fisico ?? codigo;
    const meta = cf ? CONFIG.COMMAND_META?.[cf] : null;
    if (meta?.icon) {
      const ico = document.createElement('i');
      ico.className = `bi ${meta.icon} me-1`;
      tdNombre.appendChild(ico);
    }
    const durTag = cmd?.duracion_ms ? ` (${(Number(cmd.duracion_ms) / 1000).toFixed(1)}s)` : '';
    tdNombre.appendChild(document.createTextNode(`${cmd?.nombre || '—'}${durTag}`));

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
  UI.etiquetarCeldas(tbody);
}

function mostrarAvisoMonitoreo(texto = null) {
  const box = getEl('monitorAccessNotice');
  const msg = getEl('monitorAccessNoticeText');
  if (!box) return;
  if (!texto) {
    box.hidden = true;
    return;
  }
  if (msg) msg.textContent = texto;
  box.hidden = false;
}

async function cargarPanelMonitoreo() {
  if (!STATE.vehicleId) return;
  mostrarAvisoMonitoreo(null);

  if (esUnidadBloqueadaParaAdmin(STATE.vehicleInfo)) {
    const aviso = 'Unidad vendida — requiere autorización temporal de soporte del propietario.';
    mostrarAvisoMonitoreo(aviso);
    renderUltimoMovimiento({ idComando: null, comando: aviso });
    renderHistorial([], aviso);
    renderComandosCatalogo([], aviso);
    return;
  }

  renderUltimoMovimiento(null);
  renderHistorial([], 'Consultando historial de movimientos…');
  renderComandosCatalogo([], 'Consultando catálogo de comandos…');

  const targetVehicleId = STATE.vehicleId;
  const seq = ++STATE.reconcileSeq;

  const [estadoRes, historialRes, comandosRes] = await Promise.all([
    api.obtenerEstado(targetVehicleId),
    api.obtenerHistorial(targetVehicleId),
    api.obtenerComandos(targetVehicleId),
  ]);

  // Descartar respuesta atrasada si el usuario cambió de unidad durante la consulta
  if (seq !== STATE.reconcileSeq || STATE.vehicleId !== targetVehicleId) return;

  if ((!estadoRes.ok && estadoRes.status === 403) || (!historialRes.ok && historialRes.status === 403)) {
    const msg = formatApiError(
      estadoRes.status === 403 ? estadoRes : historialRes,
      'Unidad vendida — requiere autorización temporal de soporte del propietario.'
    );
    mostrarAvisoMonitoreo(msg);
    UI.showToast(msg, 'warning');
    wsService.disconnect('Requiere autorización de soporte');
    UI.setHardwareStatus(null);
    renderUltimoMovimiento({ idComando: null, comando: msg });
    renderHistorial([], msg);
    renderComandosCatalogo(Array.isArray(comandosRes?.data) ? comandosRes.data : [], msg);
    return;
  }

  if (estadoRes.ok) {
    const estRow = Array.isArray(estadoRes.data) ? estadoRes.data[0] : estadoRes.data;
    if (estRow && estRow.conectado !== undefined) {
      UI.setHardwareStatus(Boolean(estRow.conectado));
    }
  }

  if (comandosRes.ok) {
    const comandos = Array.isArray(comandosRes.data) ? comandosRes.data : [];
    reconstruirMapaComandos(comandos);
    renderComandosCatalogo(comandos);
  } else {
    renderComandosCatalogo([], `Error al cargar comandos: ${formatApiError(comandosRes)}`);
  }

  if (historialRes.ok) {
    const historial = ordenarYAcotarHistorial(aHistorial(historialRes.data));
    STATE.monitorHistorial = historial;
    renderHistorial(historial);
    let ultimo = historial.length > 0 ? historial[0] : null;
    if (!ultimo && estadoRes.ok) {
      ultimo = aEstadoInicial({ estado: estadoRes.data, timestamp: null });
    }
    renderUltimoMovimiento(ultimo);
  } else {
    STATE.monitorHistorial = [];
    renderHistorial([], `Error al cargar historial: ${formatApiError(historialRes)}`);
    renderUltimoMovimiento(estadoRes.ok ? aEstadoInicial({ estado: estadoRes.data }) : { idComando: null });
  }
}

function ordenarYAcotarHistorial(lista = []) {
  const vistos = new Set();
  const unicos = [];
  for (const item of lista) {
    const key = item.idRegistro
      ? `id:${item.idRegistro}`
      : `ts:${item.timestamp || ''}:${item.idComando || ''}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    unicos.push(item);
  }
  unicos.sort((a, b) => {
    if (a.idRegistro && b.idRegistro && a.idRegistro !== b.idRegistro) {
      return b.idRegistro - a.idRegistro;
    }
    return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
  });
  return unicos.slice(0, MONITOREO_MAX_REGISTROS);
}

/**
 * Reconciliación REST automática tras reconexión de WSS:
 * consulta /estado y /historial, descarta respuestas atrasadas si cambió de unidad
 * y actualiza hardware ESP8266 + historial deduplicado de máx. 10 individuales.
 */
async function reconciliarEstadoTrasReconexionWss(expectedVehicleId) {
  const vid = Number(expectedVehicleId);
  if (!auth.isAuthenticated() || !vid || STATE.vehicleId !== vid) return;
  if (esUnidadBloqueadaParaAdmin(STATE.vehicleInfo)) return;

  const seq = ++STATE.reconcileSeq;
  const incluirHistorial = auth.getRole() !== 'INVITADO';
  const [estadoSettled, historialSettled] = await Promise.allSettled([
    api.obtenerEstado(vid),
    incluirHistorial ? api.obtenerHistorial(vid) : Promise.resolve({ ok: false, skipped: true }),
  ]);

  if (seq !== STATE.reconcileSeq || STATE.vehicleId !== vid) return;

  const estadoRes = estadoSettled.status === 'fulfilled' ? estadoSettled.value : null;
  const historialRes = historialSettled.status === 'fulfilled' ? historialSettled.value : null;

  if (estadoRes?.ok) {
    const estRow = Array.isArray(estadoRes.data) ? estadoRes.data[0] : estadoRes.data;
    if (estRow && estRow.conectado !== undefined) {
      UI.setHardwareStatus(Boolean(estRow.conectado));
    }
    const movEst = aEstadoInicial({ estado: estadoRes.data });
    if (movEst.idComando) {
      renderUltimoMovimiento(movEst);
    }
  }

  if (incluirHistorial && historialRes?.ok) {
    const historial = ordenarYAcotarHistorial(aHistorial(historialRes.data));
    STATE.monitorHistorial = historial;
    renderHistorial(historial);
    if (historial.length > 0) {
      renderUltimoMovimiento(historial[0]);
    }
  }
}

// ---------------------------------------------------------------------------
// SELECCIÓN DE UNIDAD ACTIVA (sin duplicar WSS ni reconectar si está bloqueada 403)
// ---------------------------------------------------------------------------
async function seleccionarVehiculoActivo(vehiculo, { conectarWss = true } = {}) {
  if (!vehiculo || !vehiculo.id_vehiculo) return false;
  const nuevoId = Number(vehiculo.id_vehiculo);
  STATE.vehicleId = nuevoId;
  STATE.vehicleInfo = vehiculo;
  api.setVehicleId(nuevoId);

  UI.updateVehicleContext({
    id: nuevoId,
    nombre: vehiculo.nombre || '',
    estadoComercial: vehiculo.estado_comercial || '',
  });
  UI.setHardwareStatus(
    vehiculo.dispositivo_conectado === undefined ? null : Boolean(vehiculo.dispositivo_conectado)
  );

  if (esUnidadBloqueadaParaAdmin(vehiculo)) {
    wsService.disconnect('Unidad vendida · requiere soporte');
    syncDiagnostics();
    reconstruirMapaComandos([]);
    STATE.demos = [];
    UI.renderDemos([]);
    UI.renderDemoSelect([]);
    return false;
  }

  if (conectarWss) {
    wsService.connect(nuevoId);
  }
  syncDiagnostics();

  const [cmdRes] = await Promise.all([api.obtenerComandos(nuevoId), cargarCatalogoDemos()]);
  if (cmdRes.ok) {
    reconstruirMapaComandos(cmdRes.data);
  } else {
    reconstruirMapaComandos([]);
  }
  return true;
}

async function cargarCatalogoDemos() {
  if (!STATE.vehicleId || !auth.isAuthenticated() || auth.getRole() === 'INVITADO') {
    STATE.demos = [];
    UI.renderDemos([]);
    UI.renderDemoSelect([]);
    return;
  }
  const res = await api.obtenerDemos(STATE.vehicleId);
  if (res.ok) {
    const demos = Array.isArray(res.data) ? res.data : res.data?.demos || [];
    STATE.demos = demos;
    UI.renderDemos(demos);
    UI.renderDemoSelect(demos);
  } else {
    UI.renderDemoError(`Error al cargar demos: ${formatApiError(res)}`);
  }
}

// ---------------------------------------------------------------------------
// NAVEGACIÓN POR VISTAS Y ROLES
// ---------------------------------------------------------------------------
function actualizarNavPills(vistaActiva) {
  document.querySelectorAll('.app-nav [data-view-switch]').forEach((btn) => {
    const activa = btn.dataset.viewSwitch === vistaActiva;
    btn.classList.toggle('active', activa);
    btn.setAttribute('aria-selected', String(activa));
  });
}

async function entrarAVista(vista) {
  const rol = auth.getRole();

  if (vista === 'auth') {
    vistaActual = 'auth';
    actualizarNavPills('auth');
    UI.setView('auth');
    return;
  }

  if (vista === 'guest') {
    vistaActual = 'guest';
    actualizarNavPills('guest');
    UI.setView('guest');
    await cargarCatalogoInvitado();
    return;
  }

  if (!auth.isAuthenticated()) {
    UI.showToast('Inicia sesión para acceder a este módulo.', 'warning');
    return entrarAVista('auth');
  }

  if (vista === 'admin') {
    if (rol !== 'ADMIN') {
      UI.showToast('Acceso denegado: módulo exclusivo de Administrador (403).', 'danger');
      return;
    }
    vistaActual = 'admin';
    actualizarNavPills('admin');
    UI.setView('admin');
    await alEntrarAdmin();
    return;
  }

  if (vista === 'user-vehicles') {
    if (rol !== 'USUARIO') {
      UI.showToast('Esta vista corresponde al perfil de Tienda / Comprador.', 'warning');
      return;
    }
    vistaActual = 'user-vehicles';
    actualizarNavPills('user-vehicles');
    UI.setView('user-vehicles');
    await cargarMisVehiculosModulo(STATE.vehicleId);
    return;
  }

  if (vista === 'monitor') {
    if (rol === 'INVITADO') {
      UI.showToast('El rol Invitado no tiene acceso al historial de Monitoreo (403).', 'warning');
      return;
    }
    return entrarAMonitor();
  }

  salirDeMonitor();
}

async function entrarAMonitor() {
  if (!STATE.vehicleId) {
    UI.showToast('No tienes una unidad seleccionada o asignada todavía.', 'warning');
    return entrarAVista(auth.getRole() === 'ADMIN' ? 'admin' : 'user-vehicles');
  }
  if (esUnidadBloqueadaParaAdmin(STATE.vehicleInfo)) {
    const aviso = 'Unidad vendida — requiere autorización temporal de soporte del propietario.';
    UI.showToast(aviso, 'warning');
    vistaActual = 'monitor';
    UI.setView('monitor');
    actualizarNavPills('monitor');
    await cargarPanelMonitoreo();
    return;
  }
  vistaActual = 'monitor';
  UI.setView('monitor');
  actualizarNavPills('monitor');
  wsService.connect(STATE.vehicleId);
  await cargarPanelMonitoreo();
}

function salirDeMonitor() {
  if (!STATE.vehicleId) {
    UI.showToast(
      auth.getRole() === 'INVITADO'
        ? 'Reserva primero una unidad en exhibición para iniciar la prueba.'
        : 'No tienes una unidad seleccionada o asignada todavía.',
      'warning'
    );
    entrarAVista(
      auth.getRole() === 'ADMIN'
        ? 'admin'
        : auth.getRole() === 'INVITADO'
          ? 'guest'
          : 'user-vehicles'
    );
    return;
  }
  if (esUnidadBloqueadaParaAdmin(STATE.vehicleInfo)) {
    UI.showToast(
      'Unidad vendida — requiere autorización temporal de soporte del propietario.',
      'warning'
    );
    entrarAVista('admin');
    return;
  }
  vistaActual = 'control';
  actualizarNavPills('control');
  wsService.connect(STATE.vehicleId);
  UI.setView(modoControlPreferido ? 'mando' : 'lobby');
}

function bindViewNavigation() {
  document.querySelectorAll('[data-view-switch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      entrarAVista(btn.dataset.viewSwitch);
    });
  });

  getEl('btnRefreshMonitor')?.addEventListener('click', () => cargarPanelMonitoreo());
  getEl('btnRefreshGuestCatalog')?.addEventListener('click', () => cargarCatalogoInvitado());
  getEl('btnRefreshMisVehiculos')?.addEventListener('click', () =>
    cargarMisVehiculosModulo(STATE.vehicleId)
  );
}

// ---------------------------------------------------------------------------
// AUTENTICACIÓN: LOGIN / LOGOUT / REACCIÓN AL CAMBIO DE SESIÓN (SIN RACE)
// ---------------------------------------------------------------------------
async function aplicarEstadoAutenticacion(session, reason = 'boot') {
  const user = session?.usuario || null;
  UI.syncAuthUi(user);

  if (!user) {
    detenerTemporizadorInvitado();
    clearGuestControlRestrictions();
    wsService.disconnect('En espera de sesión');
    STATE.vehicleId = null;
    STATE.vehicleInfo = null;
    STATE.comandosVehiculo = [];
    STATE.fisicoToComandoId.clear();
    UI.setHardwareStatus(null);
    if (UI.elements.vehicleBadge) UI.elements.vehicleBadge.textContent = 'Sin unidad';
    if (reason === 'expired') {
      UI.showToast('Tu sesión expiró o fue revocada. Inicia sesión nuevamente.', 'warning');
    }
    if (vistaActual !== 'guest' || reason === 'logout') {
      await entrarAVista('auth');
    }
    return;
  }

  if (reason === 'refresh') {
    if (STATE.vehicleId && !esUnidadBloqueadaParaAdmin(STATE.vehicleInfo)) {
      wsService.connect(STATE.vehicleId);
    }
    return;
  }

  if (user.rol === 'ADMIN') {
    detenerTemporizadorInvitado();
    clearGuestControlRestrictions();
    vistaActual = 'admin';
    actualizarNavPills('admin');
    UI.setView('admin');

    const [vehRes] = await Promise.allSettled([
      api.obtenerVehiculos(),
      alEntrarAdmin(),
    ]);
    const vehs =
      vehRes.status === 'fulfilled' && vehRes.value.ok && Array.isArray(vehRes.value.data)
        ? vehRes.value.data
        : [];
    const operable =
      vehs.find(
        (v) =>
          v.activo &&
          v.id_propietario == null &&
          (v.estado_comercial === 'EXHIBICION' || v.estado_comercial === 'DISPONIBLE')
      ) ||
      vehs.find((v) => v.activo && v.soporte_activo) ||
      vehs[0];

    if (operable) {
      await seleccionarVehiculoActivo(operable, {
        conectarWss: !esUnidadBloqueadaParaAdmin(operable),
      });
    }
    return;
  }

  if (user.rol === 'USUARIO') {
    detenerTemporizadorInvitado();
    clearGuestControlRestrictions();
    vistaActual = 'user-vehicles';
    actualizarNavPills('user-vehicles');
    UI.setView('user-vehicles');

    const mis = await cargarMisVehiculosModulo();
    if (mis.length > 0) {
      await seleccionarVehiculoActivo(mis[0]);
    } else {
      STATE.vehicleId = null;
      STATE.vehicleInfo = null;
      wsService.disconnect('Sin unidades asignadas');
    }
    return;
  }

  if (user.rol === 'INVITADO') {
    let ses = session?.sesionInvitado || null;
    // Consultar el estado y segundos restantes reales en servidor (evita contador desfasado tras F5)
    if (ses && ses.id_sesion) {
      const sesActualRes = await api.obtenerSesionInvitadoActual();
      if (sesActualRes.ok && sesActualRes.data?.estado === 'ACTIVA' && Number(sesActualRes.data?.segundos_restantes || 0) > 0) {
        ses = { ...ses, ...sesActualRes.data };
        auth.setSession({ ...auth.session, sesionInvitado: ses }, 'guest_session_sync');
      } else if (sesActualRes.status === 404 || sesActualRes.status === 401 || sesActualRes.status === 403 || (sesActualRes.ok && sesActualRes.data?.estado !== 'ACTIVA')) {
        ses = null;
        auth.clearSession('guest_expired_boot', { notify: false });
        UI.syncAuthUi(null);
        UI.showToast('Tu sesión de prueba anterior expiró o fue finalizada.', 'info');
        await entrarAVista('guest');
        return;
      }
    }
    if (ses && ses.id_sesion && ses.id_vehiculo) {
      const r = await api.obtenerVehiculo(ses.id_vehiculo);
      const vehObj = r.ok
        ? r.data
        : { id_vehiculo: ses.id_vehiculo, nombre: ses.vehiculo_nombre || `Exhibición #${ses.id_vehiculo}` };
      iniciarTemporizadorInvitado({ ...ses, vehiculo_nombre: vehObj.nombre });
      await seleccionarVehiculoActivo(vehObj);
      await entrarAVista('control');
    } else {
      // Invitado autenticado (ej. invitado@test.local) aún sin reserva -> abrir Catálogo de Exhibición
      detenerTemporizadorInvitado();
      STATE.vehicleId = null;
      STATE.vehicleInfo = null;
      wsService.disconnect('Selecciona una unidad en exhibición');
      await entrarAVista('guest');
    }
  }
}

function bindAuthEvents() {
  const formLogin = getEl('formLogin');
  const loginError = getEl('loginErrorBox');
  const formRegister = getEl('formRegister');
  const registerError = getEl('registerErrorBox');
  const tabLogin = getEl('authTabLogin');
  const tabRegister = getEl('authTabRegister');

  const cambiarModoAuth = (modo) => {
    const esRegistro = modo === 'register';
    if (formLogin) formLogin.hidden = esRegistro;
    if (formRegister) formRegister.hidden = !esRegistro;
    if (loginError) loginError.hidden = true;
    if (registerError) registerError.hidden = true;
    if (tabLogin) {
      tabLogin.classList.toggle('btn-primary', !esRegistro);
      tabLogin.classList.toggle('btn-outline-secondary', esRegistro);
      tabLogin.setAttribute('aria-pressed', String(!esRegistro));
    }
    if (tabRegister) {
      tabRegister.classList.toggle('btn-primary', esRegistro);
      tabRegister.classList.toggle('btn-outline-secondary', !esRegistro);
      tabRegister.setAttribute('aria-pressed', String(esRegistro));
    }
  };

  tabLogin?.addEventListener('click', () => cambiarModoAuth('login'));
  tabRegister?.addEventListener('click', () => cambiarModoAuth('register'));

  formRegister?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (registerError) registerError.hidden = true;

    const nombre = String(formRegister.elements.nombre.value || '').trim();
    const correo = String(formRegister.elements.correo.value || '').trim();
    const password = String(formRegister.elements.password.value || '');
    const confirmPwd = String(formRegister.elements.password_confirm.value || '');

    const mostrarErrReg = (msg) => {
      if (registerError) {
        registerError.textContent = msg;
        registerError.hidden = false;
      }
    };

    if (nombre.length < 2) return mostrarErrReg('Ingresa tu nombre completo (mínimo 2 caracteres).');
    if (!correo || !correo.includes('@')) return mostrarErrReg('Ingresa un correo electrónico válido.');
    if (password.length < 8) return mostrarErrReg('La contraseña debe tener al menos 8 caracteres.');
    if (password !== confirmPwd) return mostrarErrReg('Las contraseñas no coinciden.');

    const btn = formRegister.querySelector('button[type="submit"]');
    const origLabel = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Creando cuenta…';
    }
    let res;
    try {
      res = await auth.register(nombre, correo, password);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '';
        const ico = document.createElement('i');
        ico.className = 'bi bi-person-check me-1';
        ico.setAttribute('aria-hidden', 'true');
        btn.append(ico, document.createTextNode(origLabel.trim() || 'Crear cuenta de cliente'));
      }
    }

    if (!res.ok) {
      mostrarErrReg(res.error || 'No fue posible crear la cuenta.');
      return;
    }

    formRegister.reset();
    cambiarModoAuth('login');
    UI.showToast(`Cuenta creada. ¡Bienvenido, ${res.data?.usuario?.nombre || nombre}!`, 'success');
  });

  formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const correo = String(formLogin.elements.correo.value || '').trim();
    const password = String(formLogin.elements.password.value || '');
    if (loginError) loginError.hidden = true;

    if (!correo || !password) {
      if (loginError) {
        loginError.textContent = 'Ingresa tu correo y contraseña.';
        loginError.hidden = false;
      }
      return;
    }

    const btn = formLogin.querySelector('button[type="submit"]');
    const originalBtnText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Iniciando sesión…';
    }
    let res;
    try {
      res = await auth.login(correo, password);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '';
        const ico = document.createElement('i');
        ico.className = 'bi bi-box-arrow-in-right me-1';
        ico.setAttribute('aria-hidden', 'true');
        btn.append(ico, document.createTextNode(originalBtnText.trim() || 'Iniciar Sesión'));
      }
    }

    if (!res.ok) {
      if (loginError) {
        loginError.textContent = res.error || 'Credenciales inválidas.';
        loginError.hidden = false;
      }
      return;
    }

    formLogin.reset();
    UI.showToast(`Bienvenido, ${res.data?.usuario?.nombre || correo}`, 'success');
  });

  let cerrandoSesion = false;
  const ejecutarLogout = () => {
    if (cerrandoSesion) return;
    cerrandoSesion = true;
    try {
      // Logout optimista instantáneo: cerrar WS, limpiar storage/UI al instante y revocar en segundo plano
      detenerTemporizadorInvitado();
      clearGuestControlRestrictions();
      wsService.disconnect('En espera de sesión');
      auth.logout();
      STATE.vehicleId = null;
      STATE.vehicleInfo = null;
      STATE.comandosVehiculo = [];
      STATE.fisicoToComandoId.clear();
      UI.syncAuthUi(null);
      UI.setHardwareStatus(null);
      if (UI.elements.vehicleBadge) UI.elements.vehicleBadge.textContent = 'Sin unidad';
      vistaActual = 'auth';
      actualizarNavPills('auth');
      UI.setView('auth');
      UI.showToast('Sesión cerrada correctamente.', 'info');
    } finally {
      cerrandoSesion = false;
    }
  };

  document.addEventListener('click', (e) => {
    const btn =
      e.target && typeof e.target.closest === 'function'
        ? e.target.closest('[data-action="logout"], #btnHeaderLogout')
        : null;
    if (!btn) return;
    e.preventDefault();
    ejecutarLogout();
  });

  getEl('btnHeaderLogin')?.addEventListener('click', () => entrarAVista('auth'));
  getEl('btnGoGuestCatalog')?.addEventListener('click', () => entrarAVista('guest'));
  getEl('btnBackToLogin')?.addEventListener('click', () => entrarAVista('auth'));

  auth.onChange((session, reason) => {
    if (reason === 'guest_session_start' || reason === 'guest_session_sync') {
      UI.syncAuthUi(session?.usuario || null);
      return;
    }
    aplicarEstadoAutenticacion(session, reason);
  });
}

// ---------------------------------------------------------------------------
// WEBSOCKET: EVENTOS EN TIEMPO REAL
// ---------------------------------------------------------------------------
function mapWssState(wsState, detail = '') {
  if (wsState === 'open') return { state: 'online', detail: detail || 'En línea · Operativo' };
  if (wsState === 'connecting') return { state: 'connecting', detail: detail || 'Conectando...' };
  return { state: 'offline', detail: detail || 'Sin conexión' };
}

function syncDiagnostics(extra = {}) {
  const metrics = wsService.getMetrics();
  UI.updateDiagnostics({
    restUrl: CONFIG.BASE_URL,
    wssUrl: STATE.vehicleId ? metrics.wssUrl || CONFIG.buildDisplayWssUrl(STATE.vehicleId) : 'Sin unidad activa',
    wsReconnects: metrics.attempts,
    lastWsMessage: metrics.lastMessage,
    ...extra,
  });
}

function bindWebSocketEvents() {
  wsService.on('statusChange', ({ state, detail }) => {
    if (state === 'open') {
      UI.setWssOnline(detail || 'En línea · Operativo');
    } else {
      UI.setConnectivity({ wss: mapWssState(state, detail) });
    }
    syncDiagnostics();

    if (
      auth.isAuthenticated() &&
      STATE.vehicleId &&
      (state === 'closed' || state === 'error') &&
      STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER
    ) {
      const lastWasMovement =
        Object.values(CONFIG.COMMANDS).includes(STATE.lastSentCommand) &&
        STATE.lastSentCommand < CONFIG.COMMANDS.DEMO_FABRICA;
      if (lastWasMovement) {
        detenerVehiculo();
      }
    }

    UI.setJoystickState(state === 'open' ? 'Conectado' : state === 'connecting' ? 'Conectando' : 'Offline');
  });

  wsService.on('authError', ({ code, reason }) => {
    if (code === 4403) {
      UI.showToast(`Acceso operativo restringido (403): ${reason}`, 'warning');
    } else if (code === 4401 && auth.getRole() === 'INVITADO') {
      finalizarPruebaInvitado(reason || 'Tu sesión de prueba finalizó.');
    } else if (code === 4401 && auth.isAuthenticated()) {
      UI.showToast(`Sesión WSS cerrada: ${reason}`, 'warning');
    }
  });

  wsService.on('sesion_invitado', (payload) => {
    if (auth.getRole() === 'INVITADO') {
      const estado = String(payload?.estado || '').toUpperCase();
      if (estado === 'EXPIRADA' || estado === 'CANCELADA' || estado === 'FINALIZADA') {
        finalizarPruebaInvitado(
          estado === 'CANCELADA'
            ? 'La tienda o el administrador finalizó la prueba. Unidad detenida.'
            : 'Tiempo de prueba finalizado. Unidad detenida y liberada.'
        );
      }
    }
  });

  wsService.on('fin_demo', (payload) => {
    STATE.demoActive = false;
    UI.setDemoStatus(false);
    UI.setCommandState(CONFIG.COMMANDS.DETENER, 'VEHÍCULO DETENIDO');
    UI.setPulseState('active-stopped');
    syncDiagnostics();
    UI.showToast(`Demo finalizada (${payload?.timestamp || 'evento'})`, 'info');
    UI.demoTimelineEnd('Rutina finalizada', 'success');
  });

  wsService.on('reconnected', ({ vehicleId }) => {
    UI.showToast('Canal WSS reconectado. Reconciliando estado e historial…', 'info');
    reconciliarEstadoTrasReconexionWss(vehicleId);
  });

  wsService.on('estado_dispositivo', (payload) => {
    if (Number(payload?.id_vehiculo) === STATE.vehicleId && payload?.conectado !== undefined) {
      UI.setHardwareStatus(Boolean(payload.conectado));
    }
  });

  wsService.on('estado_inicial', (payload) => {
    const mov = aEstadoInicial(payload);
    renderUltimoMovimiento(mov);
    if (payload?.dispositivo_conectado !== undefined) {
      UI.setHardwareStatus(Boolean(payload.dispositivo_conectado));
    } else if (payload?.estado && payload.estado.conectado !== undefined) {
      UI.setHardwareStatus(Boolean(payload.estado.conectado));
    }
    syncDiagnostics();
  });

  wsService.on('movimiento_individual', (payload) => {
    const mov = aMovimientoIndividual(payload);
    STATE.monitorHistorial = ordenarYAcotarHistorial([mov, ...STATE.monitorHistorial]);
    renderHistorial(STATE.monitorHistorial);
    renderUltimoMovimiento(mov);
    syncDiagnostics();
  });

  wsService.on('movimiento_demo', (payload) => {
    STATE.demoActive = true;
    UI.setDemoStatus(true);

    const mov = aMovimientoDemo(payload);
    const cf = mov.codigoFisico;

    if (!UI.demoTimelineIsLive()) {
      UI.demoTimelineStart({ name: 'Rutina en curso' });
    }
    UI.demoTimelineAddStep(cf, {
      name: mov.comando,
      cmdId: cf,
      orden: payload?.orden,
      duracionMs: payload?.duracion_ms,
      timestamp: payload?.timestamp,
    });

    if (cf) {
      STATE.lastSentCommand = cf;
      UI.setCommandState(payload?.id_comando ?? cf, `DEMO · ${mov.comando.toUpperCase()}`);
      UI.setPulseState('active-demo');
    }

    renderUltimoMovimiento(mov);
    syncDiagnostics();
  });

  wsService.on('command_echo', (codigoFisico, payload) => {
    const cf = Number(codigoFisico);
    STATE.lastSentCommand = cf;
    syncDiagnostics();

    const ev = String(payload?.evento || payload?.tipo || '').toUpperCase();
    if (STATE.demoActive && ev !== 'MOVIMIENTO_DEMO' && ev !== 'DEMO_MOVIMIENTO') {
      UI.demoTimelineAddStep(cf, {
        name: payload?.comando || CONFIG.COMMAND_META[cf]?.label || `Comando ${cf}`,
        cmdId: cf,
      });
    }

    if (cf === CONFIG.COMMANDS.DETENER) {
      UI.setCommandState(payload?.id_comando ?? cf, 'VEHÍCULO DETENIDO');
      UI.setPulseState('active-stopped');
      return;
    }

    const label = payload?.comando || CONFIG.COMMAND_META[cf]?.label || `CMD ${cf}`;
    UI.setCommandState(payload?.id_comando ?? cf, `VEHÍCULO · ${label.toUpperCase()}`);
    UI.setPulseState(cf === CONFIG.COMMANDS.DEMO_FABRICA ? 'active-demo' : 'active-moving');
  });

  wsService.on('message', () => syncDiagnostics());
}

// ---------------------------------------------------------------------------
// POLLING DE SALUD INDEPENDIENTE: API AWS + AMAZON RDS (GET /api/health)
// ---------------------------------------------------------------------------
async function actualizarSaludApi({ showToast = false } = {}) {
  const { aws, rds } = await api.comprobarSaludCompleta();
  UI.setRdsStatus(rds);
  const status = aws.ok ? 'online' : 'offline';

  UI.setConnectivity({
    wss: mapWssState(wsService.getState(), UI.connectivityState?.wss?.detail),
    aws: {
      state: status,
      detail:
        status === 'online'
          ? `Operativo · ${aws.latencyMs} ms`
          : `No alcanzable: ${aws.error || 'Desconocido'}`,
      latencyMs: aws.latencyMs,
      httpStatus: aws.status,
      error: aws.error,
    },
  });

  syncDiagnostics({
    latencyMs: aws.latencyMs,
    httpStatus: aws.status ? `HTTP ${aws.status}` : aws.error || 'Sin respuesta',
  });

  if (showToast) {
    UI.showToast(
      `API: ${aws.ok ? `OK (${aws.latencyMs} ms)` : 'Fallo'} · RDS: ${rds.ok ? 'Disponible' : 'No disponible'}`,
      aws.ok && rds.ok ? 'success' : 'warning'
    );
  }

  return { aws, rds };
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
// LOBBY <-> MODO MANDO (conservado intacto)
// ---------------------------------------------------------------------------
async function entrarAModoMando() {
  mandoActivo = true;
  modoControlPreferido = true;
  vistaActual = 'control';
  STATE.activeController = null;
  window.activeController = null;
  UI.setControllerLock(null);
  UI.setView('mando');

  const docEl = document.documentElement;
  const lockLandscape = () => {
    try {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (_) {}
  };

  try {
    if (typeof docEl.requestFullscreen === 'function' && !document.fullscreenElement) {
      Promise.resolve(docEl.requestFullscreen()).catch(() => {}).then(lockLandscape);
    } else {
      lockLandscape();
    }
  } catch (_) {}
}

function salirDeModoMando() {
  try {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => {});
    }
  } catch (_) {}

  try {
    if (screen.orientation && typeof screen.orientation.unlock === 'function') {
      screen.orientation.unlock();
    }
  } catch (_) {}

  STATE.activeController = null;
  window.activeController = null;
  UI.setControllerLock(null);
  mandoActivo = false;
  modoControlPreferido = false;
  if (vistaActual === 'control') {
    UI.setView('lobby');
  }
}

// ---------------------------------------------------------------------------
// GOOGLE IDENTITY SERVICES (GIS): CARGA DINÁMICA SOLO SI EL BACKEND LO HABILITA
// ---------------------------------------------------------------------------
function cargarScriptGoogleGis() {
  if (window.google?.accounts?.id) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-gis-script="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(window.google?.accounts?.id)), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.gisScript = '1';
    script.onload = () => resolve(Boolean(window.google?.accounts?.id));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

async function inicializarGoogleSignIn() {
  const wrap = getEl('googleSignInWrap');
  const container = getEl('googleBtnContainer');
  if (!wrap || !container) return;

  const providers = await auth.getProviders();
  if (!providers.google_enabled || !providers.google_client_id) {
    wrap.hidden = true;
    return;
  }

  const loaded = await cargarScriptGoogleGis();
  if (!loaded || !window.google?.accounts?.id) {
    wrap.hidden = true;
    return;
  }

  try {
    window.google.accounts.id.initialize({
      client_id: providers.google_client_id,
      callback: async (response) => {
        const credential = response?.credential;
        if (!credential) {
          UI.showToast('No se recibió credencial válida de Google.', 'warning');
          return;
        }
        const res = await auth.loginWithGoogle(credential);
        if (!res.ok) {
          const errBox = getEl('loginErrorBox');
          if (errBox) {
            errBox.textContent = res.error || 'Error al iniciar sesión con Google.';
            errBox.hidden = false;
          }
          UI.showToast(res.error || 'Error al iniciar sesión con Google.', 'danger');
          return;
        }
        UI.showToast(`Bienvenido, ${res.data?.usuario?.nombre || 'Cliente'} (Google)`, 'success');
      },
    });
    container.textContent = '';
    window.google.accounts.id.renderButton(container, {
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      locale: 'es',
      width: 280,
    });
    wrap.hidden = false;
  } catch (_) {
    wrap.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// ARRANQUE GLOBAL (sin condiciones de carrera)
// ---------------------------------------------------------------------------
async function boot() {
  UI.init();

  const esPC = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  mandoActivo = esPC;
  modoControlPreferido = esPC;

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement || esPC) return;
    if (vistaActual !== 'control') return;
    if (!document.body.classList.contains('mando-control')) return;
    salirDeModoMando();
  });

  // Botón de paro de emergencia DETENER (prioridad absoluta)
  getEl('btnEmergencyStop')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (joystickController) joystickController.forceRelease();
    STATE.activeController = null;
    window.activeController = null;
    UI.setControllerLock(null);
    UI.setStopButtonState(true);

    if (STATE.demoActive) {
      UI.showToast('Cancelando rutina autónoma y deteniendo...', 'warning');
      await cancelarDemo();
    } else {
      UI.showToast('Enviando paro de emergencia (DETENER 12)...', 'warning');
      await detenerVehiculo();
    }
    UI.setStopButtonState(false);
  });

  getEl('btnEnterMando')?.addEventListener('click', entrarAModoMando);
  getEl('btnLobbyCheck')?.addEventListener('click', () => actualizarSaludApi({ showToast: true }));
  getEl('btnExitMando')?.addEventListener('click', salirDeModoMando);
  getEl('btnIniciarDemo')?.addEventListener('click', () => iniciarDemo());
  getEl('btnCancelarDemo')?.addEventListener('click', cancelarDemo);

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

  getEl('btnRunDiag')?.addEventListener('click', async () => {
    UI.showToast('Ejecutando diagnóstico de enlace...', 'info');
    await actualizarSaludApi({ showToast: true });
  });
  getEl('btnCloseDiag')?.addEventListener('click', () => {
    bootstrap.Collapse.getOrCreateInstance(getEl('diagPanel')).hide();
  });
  getEl('btnToggleDiag')?.addEventListener('click', () => {
    syncDiagnostics();
    bootstrap.Collapse.getOrCreateInstance(getEl('diagPanel')).toggle();
  });

  // Botones de acción por data-cmd (conservando cableado D-Pad 3/4 intacto)
  const ejecutarComandoBoton = async (btn) => {
    if (btn.disabled) return;
    const codigoFisico = Number(btn.dataset.cmd);

    if (codigoFisico === CONFIG.COMMANDS.DEMO_FABRICA) {
      await iniciarDemo();
      return;
    }
    if (codigoFisico === CONFIG.COMMANDS.DETENER) {
      await detenerVehiculo();
      return;
    }
    if (MOVIMIENTO_FISICO_IDS.includes(codigoFisico)) {
      await handleMovimiento(codigoFisico);
      return;
    }

    if (
      codigoFisico === CONFIG.COMMANDS.LUCES ||
      codigoFisico === CONFIG.COMMANDS.SONIDO ||
      codigoFisico === CONFIG.COMMANDS.ENCENDER ||
      codigoFisico === CONFIG.COMMANDS.APAGAR
    ) {
      if (codigoFisico === CONFIG.COMMANDS.APAGAR) {
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
      const idCmd = resolverIdComandoDesdeFisico(codigoFisico);
      if (STATE.busyCommands.has(idCmd)) return;
      STATE.busyCommands.add(idCmd);
      const resPulse = await api.enviarMovimiento(idCmd);
      STATE.busyCommands.delete(idCmd);
      if (!resPulse.ok) {
        UI.showToast(formatApiError(resPulse, `Fallo envío comando ${codigoFisico}`), 'danger');
        if (resPulse.status !== 403 && resPulse.status !== 401 && STATE.lastSentCommand !== CONFIG.COMMANDS.DETENER) {
          await detenerVehiculo();
        }
      }
      return;
    }

    if (
      codigoFisico === CONFIG.COMMANDS.ALZAR_PALA ||
      codigoFisico === CONFIG.COMMANDS.BAJAR_PALA ||
      codigoFisico === CONFIG.COMMANDS.GIRAR_DERECHA ||
      codigoFisico === CONFIG.COMMANDS.GIRAR_IZQUIERDA
    ) {
      await handleMovimiento(codigoFisico);
    }
  };

  document.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const dpadGrid = getEl('dpadGrid');
      if (dpadGrid && dpadGrid.contains(btn)) return;
      if (dpadGrid && STATE.activeController === 'joystick') return;
      await ejecutarComandoBoton(btn);
    });
  });

  const dpadGrid = getEl('dpadGrid');
  if (dpadGrid) {
    dpadGrid.addEventListener('pointerdown', async (e) => {
      if (STATE.activeController === 'joystick') return;
      const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-cmd]') : null;
      if (!btn || btn.disabled) return;
      STATE.activeController = 'dpad';
      window.activeController = 'dpad';
      UI.setControllerLock('dpad');
      await ejecutarComandoBoton(btn);
    });

    const handleDpadRelease = () => {
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

  if (getEl('currentYear')) {
    getEl('currentYear').textContent = String(new Date().getFullYear());
  }

  bindWebSocketEvents();
  initJoystick();
  bindViewNavigation();
  bindAuthEvents();

  initAdmin({
    onOperarVehiculo: async (vehiculo) => {
      if (esUnidadBloqueadaParaAdmin(vehiculo)) {
        UI.showToast(
          'Unidad vendida — requiere autorización temporal de soporte del propietario.',
          'warning'
        );
        return;
      }
      await seleccionarVehiculoActivo(vehiculo);
      salirDeMonitor();
    },
  });

  initUserVehicles({
    onSelectForControl: async (vehiculo) => {
      await seleccionarVehiculoActivo(vehiculo);
      salirDeMonitor();
    },
    onSelectForMonitor: async (vehiculo) => {
      await seleccionarVehiculoActivo(vehiculo);
      await entrarAMonitor();
    },
    onUnitDataChanged: async (idVehiculo) => {
      if (STATE.vehicleId === Number(idVehiculo)) {
        const [cmdRes] = await Promise.all([api.obtenerComandos(idVehiculo), cargarCatalogoDemos()]);
        if (cmdRes.ok) reconstruirMapaComandos(cmdRes.data);
      }
    },
    onEstadoComercialChanged: (vehiculoActualizado) => {
      if (vehiculoActualizado && STATE.vehicleId === Number(vehiculoActualizado.id_vehiculo)) {
        STATE.vehicleInfo = { ...(STATE.vehicleInfo || {}), ...vehiculoActualizado };
        UI.updateVehicleContext({
          id: vehiculoActualizado.id_vehiculo,
          nombre: vehiculoActualizado.nombre || STATE.vehicleInfo.nombre || '',
          estadoComercial: vehiculoActualizado.estado_comercial || '',
        });
      }
    },
    onExecuteCommand: async (vehiculo, cmd) => {
      if (STATE.vehicleId !== Number(vehiculo.id_vehiculo)) {
        await seleccionarVehiculoActivo(vehiculo);
      }
      await ejecutarComandoPorId(cmd.id_comando, cmd);
    },
    onExecuteDemo: async (vehiculo, demo) => {
      if (STATE.vehicleId !== Number(vehiculo.id_vehiculo)) {
        await seleccionarVehiculoActivo(vehiculo);
      }
      await iniciarDemo(demo.id_demo);
    },
    onCancelDemo: async (vehiculo) => {
      if (STATE.vehicleId !== Number(vehiculo.id_vehiculo)) {
        await seleccionarVehiculoActivo(vehiculo);
      }
      await cancelarDemo();
    },
  });

  initGuestModule({
    onSessionStarted: async (sesion) => {
      UI.syncAuthUi(auth.getUser());
      const vehObj = {
        id_vehiculo: sesion.id_vehiculo,
        nombre: sesion.vehiculo_nombre || `Exhibición #${sesion.id_vehiculo}`,
        estado_comercial: 'EXHIBICION',
      };
      await seleccionarVehiculoActivo(vehObj);
      salirDeMonitor();
    },
    onSessionEnded: async () => {
      wsService.disconnect('Prueba finalizada');
      STATE.vehicleId = null;
      STATE.vehicleInfo = null;
      UI.syncAuthUi(null);
      UI.setHardwareStatus(null);
      if (UI.elements.vehicleBadge) UI.elements.vehicleBadge.textContent = 'Sin unidad';
      await entrarAVista('guest');
    },
  });

  // 1. Verificar sesión JWT persistida primero (evita condiciones de carrera con vehicleId)
  const verificacion = await auth.verifySession();
  const authFlowPromise = aplicarEstadoAutenticacion(
    verificacion.valid ? auth.session : null,
    verificacion.reason === 'expired' ? 'expired' : 'boot'
  );

  // 2. Salud independiente AWS + RDS y proveedor Google Sign-In en paralelo
  const healthPromise = iniciarSaludPolling();
  const googlePromise = inicializarGoogleSignIn();

  await Promise.all([authFlowPromise, healthPromise, googlePromise]);
}

if (document.getElementById('mainContent')) {
  boot().catch((err) => {
    console.error('[BOOT] Error crítico en inicialización:', err);
    UI.showToast(`Error de arranque: ${err.message}`, 'danger');
  });
}
