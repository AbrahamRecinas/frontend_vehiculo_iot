/**
 * admin.js
 * Módulo de Administración: CRUD de vehículos, comandos, demos y pasos de demo
 * contra la API REST. Editar y eliminar usan POST (nunca PUT ni DELETE).
 * Protección visual por contraseña (sessionStorage) y semáforo de Amazon RDS.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';
import { api } from './api.js?v=2.4';
import { UI } from './ui.js?v=2.6';

const ADMIN_PASSWORD = 'admin123';
const ADMIN_SESSION_KEY = 'adminDesbloqueado';

const ID_KEY = { vehiculo: 'id_vehiculo', comando: 'id_comando', demo: 'id_demo', paso: 'id_demo_movimiento' };
const LISTA_KEY = { vehiculo: 'vehiculos', comando: 'comandos', demo: 'demos', paso: 'pasos' };
const TBODY_ID = { vehiculo: 'adminVehiculosBody', comando: 'adminComandosBody', demo: 'adminDemosBody', paso: 'adminPasosBody' };
const MODAL_ID = { vehiculo: 'modalVehiculo', comando: 'modalComando', demo: 'modalDemo', paso: 'modalPaso' };
const FORM_ID = { vehiculo: 'formVehiculo', comando: 'formComando', demo: 'formDemo', paso: 'formPaso' };
const TITULO_ID = { vehiculo: 'modalVehiculoTitulo', comando: 'modalComandoTitulo', demo: 'modalDemoTitulo', paso: 'modalPasoTitulo' };
const WRAP_ID = { vehiculo: 'wrapActivoVehiculo', comando: 'wrapActivoComando', demo: 'wrapActivoDemo' };
const NOMBRE = { vehiculo: 'vehículo', comando: 'comando', demo: 'demo', paso: 'paso' };
const CAMPOS = {
  vehiculo: ['nombre', 'modelo', 'microcontrolador', 'descripcion'],
  comando: ['nombre', 'codigo', 'descripcion'],
  demo: ['nombre', 'descripcion'],
  paso: ['orden', 'duracion_ms', 'pausa_ms'],
};

const ESTADO = {
  vehiculos: [],
  comandos: [],
  demos: [],
  pasos: [],
  vehiculoId: CONFIG.VEHICLE_ID,
  demoId: null,
};

let generacionPasos = 0;
let resolverAcceso = null;
let accionPendiente = null;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// PETICIONES A LA API (solo POST para crear, editar y eliminar; sin auth)
// ---------------------------------------------------------------------------
const get = (endpoint) => api.request(endpoint, { method: 'GET' });
const post = (endpoint, datos) =>
  api.request(endpoint, { method: 'POST', ...(datos ? { body: JSON.stringify(datos) } : {}) });

const adminApi = {
  vehiculos: {
    listar: () => get('/api/vehiculos/'),
    crear: (datos) => post('/api/vehiculos/', datos),
    actualizar: (id, datos) => post(`/api/vehiculos/${id}/actualizar`, datos),
    eliminar: (id) => post(`/api/vehiculos/${id}/eliminar`),
  },
  comandos: {
    listar: (vid) => get(`/api/vehiculos/${vid}/comandos`),
    crear: (vid, datos) => post(`/api/vehiculos/${vid}/comandos`, datos),
    actualizar: (id, datos) => post(`/api/vehiculos/comandos/${id}/actualizar`, datos),
    eliminar: (id) => post(`/api/vehiculos/comandos/${id}/eliminar`),
  },
  demos: {
    listar: (vid) => get(`/api/vehiculos/${vid}/demos`),
    crear: (vid, datos) => post(`/api/vehiculos/${vid}/demos`, datos),
    actualizar: (id, datos) => post(`/api/vehiculos/demos/${id}/actualizar`, datos),
    eliminar: (id) => post(`/api/vehiculos/demos/${id}/eliminar`),
  },
  pasos: {
    listar: (demoId) => get(`/api/vehiculos/demos/${demoId}/movimientos`),
    crear: (demoId, datos) => post(`/api/vehiculos/demos/${demoId}/movimientos`, datos),
    actualizar: (id, datos) => post(`/api/vehiculos/movimientos_demo/${id}/actualizar`, datos),
    eliminar: (id) => post(`/api/vehiculos/movimientos_demo/${id}/eliminar`),
  },
};

// ---------------------------------------------------------------------------
// UTILIDADES
// ---------------------------------------------------------------------------
const lista = (res) => (res?.ok && Array.isArray(res.data) ? res.data : []);
const vacio = (v) => v === null || v === undefined || v === '';
const capitalizar = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esActivo = (v) => v === 1 || v === true || v === '1';

const toast = (mensaje, tipo = 'info') => UI.showToast(mensaje, tipo);

function mensajeError(res) {
  const detalle = res?.data?.detail;
  if (typeof detalle === 'string') return detalle;
  if (Array.isArray(detalle) && detalle.length) {
    return detalle.map((d) => d?.msg || JSON.stringify(d)).join('; ');
  }
  return res?.error || 'Error desconocido';
}

function elegirSeleccion(ids, actual, preferido) {
  if (ids.includes(actual)) return actual;
  if (ids.includes(preferido)) return preferido;
  return ids.length ? ids[0] : null;
}

function actualizarRds(res) {
  UI.setRdsStatus(res);
}

// ---------------------------------------------------------------------------
// RENDER DE TABLAS (DOM API con textContent; sin innerHTML con datos de la API)
// ---------------------------------------------------------------------------
function crearBoton({ icono, texto, clase, accion, tipo, id }) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = `btn btn-sm ${clase} me-1`;
  boton.dataset.accion = accion;
  if (tipo) boton.dataset.tipo = tipo;
  if (id !== undefined) boton.dataset.id = String(id);
  const i = document.createElement('i');
  i.className = `bi ${icono} me-1`;
  i.setAttribute('aria-hidden', 'true');
  boton.append(i, document.createTextNode(texto));
  return boton;
}

function celda(valor, clase = '') {
  const td = document.createElement('td');
  if (clase) td.className = clase;
  td.textContent = vacio(valor) ? '—' : String(valor);
  return td;
}

function celdaEstado(activo) {
  const td = document.createElement('td');
  td.className = 'text-center';
  const badge = document.createElement('span');
  badge.className = esActivo(activo)
    ? 'badge bg-success-subtle text-success border border-success-subtle'
    : 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
  badge.textContent = esActivo(activo) ? 'Activo' : 'Inactivo';
  td.appendChild(badge);
  return td;
}

function filaTabla(tipo, item, celdas, extras = []) {
  const id = item[ID_KEY[tipo]];
  const tr = document.createElement('tr');
  const acciones = document.createElement('td');
  acciones.className = 'text-end text-nowrap';
  acciones.append(
    ...extras,
    crearBoton({ icono: 'bi-pencil-square', texto: 'Editar', clase: 'btn-outline-info', accion: 'editar', tipo, id }),
    crearBoton({ icono: 'bi-trash', texto: 'Eliminar', clase: 'btn-outline-danger', accion: 'eliminar', tipo, id })
  );
  tr.append(...celdas, acciones);
  return tr;
}

function pintarMensaje(tipo, texto, tono = 'secondary') {
  const tbody = $(TBODY_ID[tipo]);
  if (!tbody) return;
  tbody.textContent = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = tbody.closest('table').tHead.rows[0].cells.length;
  td.className = `text-center small py-3 text-${tono}`;
  td.textContent = texto;
  tr.appendChild(td);
  tbody.appendChild(tr);
  UI.etiquetarCeldas(tbody);
}

function pintarTabla(tipo, items, filaFn) {
  const tbody = $(TBODY_ID[tipo]);
  tbody.textContent = '';
  if (!items.length) {
    pintarMensaje(tipo, 'Sin registros.');
    return;
  }
  items.forEach((item) => tbody.appendChild(filaFn(item)));
  UI.etiquetarCeldas(tbody);
}

function filaVehiculo(v) {
  return filaTabla('vehiculo', v, [
    celda(v.id_vehiculo, 'text-center font-monospace'),
    celda(v.nombre),
    celda(v.modelo),
    celda(v.microcontrolador),
    celdaEstado(v.activo),
  ]);
}

function filaComando(c) {
  return filaTabla('comando', c, [
    celda(c.id_comando, 'text-center font-monospace'),
    celda(c.codigo, 'text-center font-monospace'),
    celda(c.nombre),
    celda(c.descripcion, 'text-secondary small'),
    celdaEstado(c.activo),
  ]);
}

function filaDemo(d) {
  const verPasos = crearBoton({
    icono: 'bi-list-ol',
    texto: 'Pasos',
    clase: 'btn-outline-secondary',
    accion: 'ver-pasos',
    tipo: 'demo',
    id: d.id_demo,
  });
  return filaTabla(
    'demo',
    d,
    [
      celda(d.id_demo, 'text-center font-monospace'),
      celda(d.nombre),
      celda(d.descripcion, 'text-secondary small'),
      celdaEstado(d.activo),
    ],
    [verPasos]
  );
}

function filaPaso(p) {
  const comando = ESTADO.comandos.find((c) => c.id_comando === p.id_comando);
  const nombreComando = comando ? `${comando.nombre} (cód. ${comando.codigo})` : `Comando #${p.id_comando}`;
  return filaTabla('paso', p, [
    celda(p.orden, 'text-center font-monospace'),
    celda(nombreComando),
    celda(`${p.duracion_ms} ms`, 'text-center font-monospace'),
    celda(`${p.pausa_ms} ms`, 'text-center font-monospace'),
  ]);
}

const FILA_FN = { vehiculo: filaVehiculo, comando: filaComando, demo: filaDemo, paso: filaPaso };

function pintarPasos() {
  pintarTabla('paso', ESTADO.pasos, FILA_FN.paso);
}

// ---------------------------------------------------------------------------
// CARGA DE DATOS
// ---------------------------------------------------------------------------
function poblarSelectorVehiculos(textoVacio = 'Sin vehículos') {
  const select = $('adminVehiculoSelect');
  select.textContent = '';
  if (!ESTADO.vehiculos.length) {
    select.appendChild(new Option(textoVacio, ''));
    select.disabled = true;
    ESTADO.vehiculoId = null;
    return;
  }
  ESTADO.vehiculos.forEach((v) => {
    select.appendChild(new Option(`${v.nombre} (#${v.id_vehiculo})`, String(v.id_vehiculo)));
  });
  select.disabled = false;
  ESTADO.vehiculoId = elegirSeleccion(
    ESTADO.vehiculos.map((v) => v.id_vehiculo),
    ESTADO.vehiculoId,
    CONFIG.VEHICLE_ID
  );
  select.value = String(ESTADO.vehiculoId);
}

function poblarSelectDemos() {
  const select = $('adminDemoSelect');
  select.textContent = '';
  if (!ESTADO.demos.length) {
    ESTADO.demoId = null;
    select.appendChild(new Option('Sin demos', ''));
    select.disabled = true;
    return;
  }
  ESTADO.demos.forEach((d) => {
    select.appendChild(new Option(`${d.nombre} (#${d.id_demo})`, String(d.id_demo)));
  });
  select.disabled = false;
  ESTADO.demoId = elegirSeleccion(ESTADO.demos.map((d) => d.id_demo), ESTADO.demoId, null);
  select.value = String(ESTADO.demoId);
}

function poblarSelectComandos(select, seleccionado = null) {
  select.textContent = '';
  select.appendChild(new Option('Selecciona un comando…', ''));
  ESTADO.comandos.forEach((c) => {
    select.appendChild(new Option(`${c.nombre} (cód. ${c.codigo})`, String(c.id_comando)));
  });
  if (seleccionado !== null) select.value = String(seleccionado);
}

async function procesarVehiculos(res) {
  actualizarRds(res);
  if (!res.ok) {
    ESTADO.vehiculos = [];
    pintarMensaje('vehiculo', `Error al cargar vehículos: ${mensajeError(res)}`, 'danger');
    poblarSelectorVehiculos('Error al cargar');
  } else {
    ESTADO.vehiculos = lista(res);
    pintarTabla('vehiculo', ESTADO.vehiculos, FILA_FN.vehiculo);
    poblarSelectorVehiculos();
  }
  await cargarDatosVehiculo();
}

async function recargarVehiculos() {
  const res = await adminApi.vehiculos.listar();
  await procesarVehiculos(res);
}

export async function alEntrarAdmin() {
  const res = await adminApi.vehiculos.listar();
  await procesarVehiculos(res);
}

async function cargarDatosVehiculo() {
  if (!ESTADO.vehiculoId) {
    ESTADO.comandos = [];
    ESTADO.demos = [];
    pintarMensaje('comando', 'Selecciona un vehículo.');
    pintarMensaje('demo', 'Selecciona un vehículo.');
    poblarSelectDemos();
    await cargarPasos();
    return;
  }
  await Promise.all([cargarComandos(), cargarDemos()]);
  await cargarPasos();
}

async function cargarComandos() {
  const vid = ESTADO.vehiculoId;
  if (!vid) return;
  pintarMensaje('comando', 'Cargando comandos…');
  const res = await adminApi.comandos.listar(vid);
  if (vid !== ESTADO.vehiculoId) return;
  if (!res.ok) {
    ESTADO.comandos = [];
    pintarMensaje('comando', `Error al cargar comandos: ${mensajeError(res)}`, 'danger');
    return;
  }
  ESTADO.comandos = lista(res).sort((a, b) => Number(a.codigo) - Number(b.codigo));
  pintarTabla('comando', ESTADO.comandos, FILA_FN.comando);
}

async function cargarDemos() {
  const vid = ESTADO.vehiculoId;
  if (!vid) return;
  pintarMensaje('demo', 'Cargando demos…');
  const res = await adminApi.demos.listar(vid);
  if (vid !== ESTADO.vehiculoId) return;
  if (!res.ok) {
    ESTADO.demos = [];
    pintarMensaje('demo', `Error al cargar demos: ${mensajeError(res)}`, 'danger');
    poblarSelectDemos();
    return;
  }
  ESTADO.demos = lista(res);
  pintarTabla('demo', ESTADO.demos, FILA_FN.demo);
  poblarSelectDemos();
}

async function cargarPasos() {
  const demoId = ESTADO.demoId;
  const botonNuevo = $('btnAdminNuevoPaso');
  if (botonNuevo) botonNuevo.disabled = !demoId;

  const generacion = ++generacionPasos;
  if (!demoId) {
    ESTADO.pasos = [];
    pintarMensaje('paso', 'Selecciona una demo para ver sus pasos.');
    return;
  }

  pintarMensaje('paso', 'Cargando pasos…');
  const res = await adminApi.pasos.listar(demoId);
  if (generacion !== generacionPasos) return;
  if (!res.ok) {
    ESTADO.pasos = [];
    pintarMensaje('paso', `Error al cargar pasos: ${mensajeError(res)}`, 'danger');
    return;
  }
  ESTADO.pasos = lista(res).sort((a, b) => Number(a.orden) - Number(b.orden));
  pintarPasos();
}

async function refrescar(tipo) {
  if (tipo === 'vehiculo') return recargarVehiculos();
  if (tipo === 'comando') {
    await cargarComandos();
    return cargarPasos();
  }
  if (tipo === 'demo') {
    await cargarDemos();
    return cargarPasos();
  }
  return cargarPasos();
}

// ---------------------------------------------------------------------------
// FORMULARIOS: ABRIR, VALIDAR Y GUARDAR
// ---------------------------------------------------------------------------
function buscarItem(tipo, id) {
  return ESTADO[LISTA_KEY[tipo]].find((i) => i[ID_KEY[tipo]] === id);
}

function siguienteOrden() {
  return Math.max(0, ...ESTADO.pasos.map((p) => Number(p.orden) || 0)) + 1;
}

function abrirFormulario(tipo, item = null) {
  if (tipo !== 'vehiculo' && !ESTADO.vehiculoId) {
    toast('Selecciona primero un vehículo.', 'warning');
    return;
  }
  if (tipo === 'paso' && !ESTADO.demoId) {
    toast('Selecciona primero una demo.', 'warning');
    return;
  }
  if (tipo === 'paso' && !ESTADO.comandos.length) {
    toast('El vehículo no tiene comandos registrados.', 'warning');
    return;
  }

  const form = $(FORM_ID[tipo]);
  const editando = Boolean(item);
  form.reset();
  form.elements.id.value = editando ? String(item[ID_KEY[tipo]]) : '';
  $(TITULO_ID[tipo]).textContent = `${editando ? 'Editar' : 'Nuevo'} ${NOMBRE[tipo]}`;

  CAMPOS[tipo].forEach((name) => {
    form.elements[name].value = editando && !vacio(item[name]) ? String(item[name]) : '';
  });

  if (tipo === 'paso') {
    poblarSelectComandos(form.elements.id_comando, editando ? item.id_comando : null);
    if (!editando) {
      form.elements.orden.value = String(siguienteOrden());
      form.elements.duracion_ms.value = '1000';
      form.elements.pausa_ms.value = '0';
    }
  }

  if (WRAP_ID[tipo]) {
    $(WRAP_ID[tipo]).hidden = !editando;
    form.elements.activo.checked = editando && esActivo(item.activo);
  }

  bootstrap.Modal.getOrCreateInstance($(MODAL_ID[tipo])).show();
}

function leerTexto(form, name) {
  return String(form.elements[name]?.value ?? '').trim();
}

function leerEntero(form, name) {
  const raw = leerTexto(form, name);
  if (raw === '') return NaN;
  const n = Number(raw);
  return Number.isInteger(n) ? n : NaN;
}

const VALIDADORES = {
  vehiculo(form, editando) {
    const datos = {
      nombre: leerTexto(form, 'nombre'),
      modelo: leerTexto(form, 'modelo'),
      microcontrolador: leerTexto(form, 'microcontrolador'),
      descripcion: leerTexto(form, 'descripcion'),
    };
    if (!datos.nombre) return { error: 'El nombre del vehículo es obligatorio.' };
    if (!datos.modelo) return { error: 'El modelo del vehículo es obligatorio.' };
    if (editando) datos.activo = form.elements.activo.checked ? 1 : 0;
    return { datos };
  },

  comando(form, editando) {
    const datos = {
      nombre: leerTexto(form, 'nombre'),
      codigo: leerEntero(form, 'codigo'),
      descripcion: leerTexto(form, 'descripcion'),
    };
    if (!datos.nombre) return { error: 'El nombre del comando es obligatorio.' };
    if (!Number.isInteger(datos.codigo) || datos.codigo < 1) {
      return { error: 'El código del comando debe ser un entero mayor o igual a 1.' };
    }
    if (editando) datos.activo = form.elements.activo.checked ? 1 : 0;
    return { datos };
  },

  demo(form, editando) {
    const datos = {
      nombre: leerTexto(form, 'nombre'),
      descripcion: leerTexto(form, 'descripcion'),
    };
    if (!datos.nombre) return { error: 'El nombre de la demo es obligatorio.' };
    if (editando) datos.activo = form.elements.activo.checked ? 1 : 0;
    return { datos };
  },

  paso(form) {
    const datos = {
      id_comando: leerEntero(form, 'id_comando'),
      orden: leerEntero(form, 'orden'),
      duracion_ms: leerEntero(form, 'duracion_ms'),
      pausa_ms: leerEntero(form, 'pausa_ms'),
    };
    if (!Number.isInteger(datos.id_comando)) return { error: 'Selecciona un comando.' };
    if (!Number.isInteger(datos.orden) || datos.orden < 1) {
      return { error: 'El orden debe ser un entero mayor o igual a 1.' };
    }
    if (!Number.isInteger(datos.duracion_ms) || datos.duracion_ms < 100) {
      return { error: 'La duración debe ser un entero mayor o igual a 100 ms.' };
    }
    if (!Number.isInteger(datos.pausa_ms) || datos.pausa_ms < 0) {
      return { error: 'La pausa debe ser un entero mayor o igual a 0 ms.' };
    }
    return { datos };
  },
};

async function ejecutarGuardado(tipo, id, datos, editando) {
  switch (tipo) {
    case 'vehiculo':
      return editando ? adminApi.vehiculos.actualizar(id, datos) : adminApi.vehiculos.crear(datos);
    case 'comando':
      return editando
        ? adminApi.comandos.actualizar(id, datos)
        : adminApi.comandos.crear(ESTADO.vehiculoId, datos);
    case 'demo':
      return editando ? adminApi.demos.actualizar(id, datos) : adminApi.demos.crear(ESTADO.vehiculoId, datos);
    case 'paso':
      return editando ? adminApi.pasos.actualizar(id, datos) : adminApi.pasos.crear(ESTADO.demoId, datos);
    default:
      return { ok: false, error: 'Tipo desconocido' };
  }
}

async function guardarFormulario(tipo, form) {
  const editando = form.elements.id.value !== '';
  const { datos, error } = VALIDADORES[tipo](form, editando);
  if (error) {
    toast(error, 'warning');
    return;
  }

  const id = editando ? Number(form.elements.id.value) : null;
  const boton = form.querySelector('button[type="submit"]');
  boton.disabled = true;
  const res = await ejecutarGuardado(tipo, id, datos, editando);
  boton.disabled = false;

  if (!res.ok) {
    toast(`No se pudo guardar el ${NOMBRE[tipo]}: ${mensajeError(res)}`, 'danger');
    return;
  }

  bootstrap.Modal.getOrCreateInstance($(MODAL_ID[tipo])).hide();
  toast(`${capitalizar(NOMBRE[tipo])} ${editando ? 'actualizado' : 'creado'} correctamente.`, 'success');
  await refrescar(tipo);
}

// ---------------------------------------------------------------------------
// ELIMINAR CON CONFIRMACIÓN
// ---------------------------------------------------------------------------
function etiquetaItem(tipo, item) {
  if (tipo === 'paso') return `Paso ${item.orden}`;
  return item.nombre;
}

function pedirEliminacion(tipo, id) {
  const item = buscarItem(tipo, id);
  const etiqueta = item ? etiquetaItem(tipo, item) : `#${id}`;
  $('confirmarTexto').textContent =
    `¿Eliminar el ${NOMBRE[tipo]} "${etiqueta}"? Esta acción no se puede deshacer. ` +
    'Si tiene elementos asociados, también podrían eliminarse en cascada.';
  accionPendiente = () => ejecutarEliminacion(tipo, id);
  bootstrap.Modal.getOrCreateInstance($('modalConfirmar')).show();
}

function eliminarPorTipo(tipo, id) {
  switch (tipo) {
    case 'vehiculo': return adminApi.vehiculos.eliminar(id);
    case 'comando': return adminApi.comandos.eliminar(id);
    case 'demo': return adminApi.demos.eliminar(id);
    case 'paso': return adminApi.pasos.eliminar(id);
    default: return Promise.resolve({ ok: false, error: 'Tipo desconocido' });
  }
}

async function ejecutarEliminacion(tipo, id) {
  const res = await eliminarPorTipo(tipo, id);
  if (!res.ok) {
    toast(`No se pudo eliminar el ${NOMBRE[tipo]}: ${mensajeError(res)}`, 'danger');
    return;
  }
  toast(`${capitalizar(NOMBRE[tipo])} eliminado.`, 'success');
  await refrescar(tipo);
}

// ---------------------------------------------------------------------------
// ACCIONES DE LA VISTA (delegación de eventos)
// ---------------------------------------------------------------------------
function verPasosDeDemo(demoId) {
  ESTADO.demoId = demoId;
  poblarSelectDemos();
  cargarPasos();
  bootstrap.Tab.getOrCreateInstance($('adminTabPasos')).show();
}

function manejarAccion(btn) {
  const { accion, tipo } = btn.dataset;
  const id = Number(btn.dataset.id);

  if (accion === 'nuevo') {
    abrirFormulario(tipo);
  } else if (accion === 'editar') {
    const item = buscarItem(tipo, id);
    if (item) abrirFormulario(tipo, item);
  } else if (accion === 'eliminar') {
    pedirEliminacion(tipo, id);
  } else if (accion === 'ver-pasos') {
    verPasosDeDemo(id);
  }
}

// ---------------------------------------------------------------------------
// CONTRASEÑA VISUAL (sessionStorage: se pide una vez por sesión de navegación)
// ---------------------------------------------------------------------------
function estaDesbloqueado() {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function marcarDesbloqueado() {
  try {
    sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
  } catch (_) { /* Almacenamiento no disponible: se pedirá de nuevo */ }
}

export function solicitarAcceso() {
  if (estaDesbloqueado()) return Promise.resolve(true);

  return new Promise((resolve) => {
    if (resolverAcceso) resolverAcceso(false);
    resolverAcceso = resolve;
    $('formAdminPassword').reset();
    $('adminPasswordError').hidden = true;
    $('adminPasswordInput').classList.remove('is-invalid');
    bootstrap.Modal.getOrCreateInstance($('modalAdminPassword')).show();
  });
}

// ---------------------------------------------------------------------------
// INICIALIZACIÓN: se llama una sola vez desde app.js
// ---------------------------------------------------------------------------
export function initAdmin() {
  $('formAdminPassword').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('adminPasswordInput');
    if (input.value !== ADMIN_PASSWORD) {
      $('adminPasswordError').hidden = false;
      input.classList.add('is-invalid');
      input.select();
      return;
    }
    marcarDesbloqueado();
    const resolver = resolverAcceso;
    resolverAcceso = null;
    bootstrap.Modal.getOrCreateInstance($('modalAdminPassword')).hide();
    if (resolver) resolver(true);
  });

  $('modalAdminPassword').addEventListener('shown.bs.modal', () => {
    $('adminPasswordInput').focus();
  });

  $('modalAdminPassword').addEventListener('hidden.bs.modal', () => {
    const resolver = resolverAcceso;
    resolverAcceso = null;
    $('adminPasswordInput').value = '';
    if (resolver) resolver(false);
  });

  $('adminView').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-accion]');
    if (btn) manejarAccion(btn);
  });

  $('adminVehiculoSelect').addEventListener('change', (e) => {
    ESTADO.vehiculoId = Number(e.target.value) || null;
    cargarDatosVehiculo();
  });

  $('adminDemoSelect').addEventListener('change', (e) => {
    ESTADO.demoId = Number(e.target.value) || null;
    cargarPasos();
  });

  Object.entries(FORM_ID).forEach(([tipo, formId]) => {
    $(formId).addEventListener('submit', (e) => {
      e.preventDefault();
      guardarFormulario(tipo, e.currentTarget);
    });
  });

  $('btnConfirmarAccion').addEventListener('click', async () => {
    const accion = accionPendiente;
    if (!accion) return;
    const boton = $('btnConfirmarAccion');
    accionPendiente = null;
    boton.disabled = true;
    await accion();
    boton.disabled = false;
    bootstrap.Modal.getOrCreateInstance($('modalConfirmar')).hide();
  });
}
