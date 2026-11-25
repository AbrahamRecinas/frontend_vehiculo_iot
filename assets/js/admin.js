/**
 * admin.js
 * Módulo de Administración 4.3 (solo rol ADMIN verificado con JWT real):
 *  - Dashboard KPIs (/api/admin/dashboard)
 *  - CRUD de Modelos y Capacidades (modelos / modelo_capacidades)
 *  - CRUD de Unidades físicas (vehiculos) + baja lógica + asignación de propietario + historial
 *  - CRUD de Clientes / Usuarios (usuarios)
 *  - Gestión de Comandos v2 (Base continuo vs Temporizado 1..10000 ms + permitido_invitado)
 *  - Demos de Fábrica y Pasos (con reordenamiento atómico)
 *  - Consulta filtrable y paginada de Auditoría (auditoria)
 * Todo dato de la API se renderiza exclusivamente con textContent.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';
import { api, formatApiError } from './api.js';
import { UI } from './ui.js?v=4.3.4';

const DEFAULT_MODEL_IMG = './assets/img/modelo-default.svg';
const GRUA_MODEL_IMG = './assets/img/modelo-grua.svg';

function resolverImgModelo(m) {
  const url = String(m?.url_imagen || '').trim();
  if (url) return url;
  const txt = `${m?.codigo_modelo || ''} ${m?.nombre_comercial || ''}`.toUpperCase();
  return txt.includes('GRUA') || txt.includes('GRÚA') ? GRUA_MODEL_IMG : DEFAULT_MODEL_IMG;
}

const $ = (id) => document.getElementById(id);
const lista = (res) => (res?.ok && Array.isArray(res.data) ? res.data : []);
const vacio = (v) => v === null || v === undefined || v === '';
const esActivo = (v) => v === 1 || v === true || v === '1';
const toast = (msg, tipo = 'info') => UI.showToast(msg, tipo);

const ESTADO = {
  dashboard: null,
  modelos: [],
  capacidades: [],
  modeloId: null,
  vehiculos: [],
  filtroEstadoVehiculo: '',
  usuarios: [],
  comandos: [],
  demos: [],
  pasos: [],
  vehiculoId: CONFIG.VEHICLE_ID,
  demoId: null,
  auditoria: {
    items: [],
    total: 0,
    limit: 25,
    offset: 0,
  },
};

let onOperarVehiculoCallback = null;
let accionPendiente = null;
let generacionPasos = 0;

// ---------------------------------------------------------------------------
// API DE ADMINISTRACIÓN (con JWT automático en api.js)
// ---------------------------------------------------------------------------
const adminApi = {
  dashboard: () => api.get(CONFIG.ENDPOINTS.ADMIN_DASHBOARD),
  modelos: {
    listar: () => api.get(CONFIG.ENDPOINTS.MODELOS),
    crear: (d) => api.post(CONFIG.ENDPOINTS.MODELOS, d),
    actualizar: (id, d) => api.post(CONFIG.ENDPOINTS.MODELO_ACTUALIZAR(id), d),
    eliminar: (id) => api.post(CONFIG.ENDPOINTS.MODELO_ELIMINAR(id)),
  },
  capacidades: {
    listar: (mid) => api.get(CONFIG.ENDPOINTS.MODELO_CAPACIDADES(mid)),
    crear: (mid, d) => api.post(CONFIG.ENDPOINTS.MODELO_CAPACIDADES(mid), d),
    actualizar: (id, d) => api.post(CONFIG.ENDPOINTS.CAPACIDAD_ACTUALIZAR(id), d),
    eliminar: (id) => api.post(CONFIG.ENDPOINTS.CAPACIDAD_ELIMINAR(id)),
  },
  vehiculos: {
    listar: (estado = '') =>
      api.get(estado ? `${CONFIG.ENDPOINTS.VEHICULOS}?estado_comercial=${encodeURIComponent(estado)}` : CONFIG.ENDPOINTS.VEHICULOS),
    crear: (d) => api.post(CONFIG.ENDPOINTS.VEHICULOS, d),
    actualizar: (id, d) => api.post(CONFIG.ENDPOINTS.VEHICULO_ACTUALIZAR(id), d),
    eliminar: (id) => api.post(CONFIG.ENDPOINTS.VEHICULO_ELIMINAR(id)),
    asignar: (id, d) => api.post(CONFIG.ENDPOINTS.VEHICULO_ASIGNAR(id), d),
    historialPropietarios: (id) => api.get(CONFIG.ENDPOINTS.VEHICULO_PROPIETARIOS_HISTORIAL(id)),
  },
  usuarios: {
    listar: () => api.get(CONFIG.ENDPOINTS.USUARIOS),
    crear: (d) => api.post(CONFIG.ENDPOINTS.USUARIOS, d),
    actualizar: (id, d) => api.post(CONFIG.ENDPOINTS.USUARIO_ACTUALIZAR(id), d),
    desactivar: (id) => api.post(CONFIG.ENDPOINTS.USUARIO_DESACTIVAR(id)),
  },
  comandos: {
    listar: (vid) => api.get(CONFIG.ENDPOINTS.COMANDOS(vid)),
    crear: (vid, d) => api.post(CONFIG.ENDPOINTS.COMANDOS(vid), d),
    actualizar: (id, d) => api.post(CONFIG.ENDPOINTS.COMANDO_ACTUALIZAR(id), d),
    eliminar: (id) => api.post(CONFIG.ENDPOINTS.COMANDO_ELIMINAR(id)),
  },
  demos: {
    listar: (vid) => api.get(CONFIG.ENDPOINTS.DEMOS(vid)),
    crear: (vid, d) => api.post(CONFIG.ENDPOINTS.DEMOS(vid), d),
    actualizar: (id, d) => api.post(CONFIG.ENDPOINTS.DEMO_ACTUALIZAR(id), d),
    eliminar: (id) => api.post(CONFIG.ENDPOINTS.DEMO_ELIMINAR(id)),
  },
  pasos: {
    listar: (did) => api.get(CONFIG.ENDPOINTS.DEMO_MOVIMIENTOS(did)),
    crear: (did, d) => api.post(CONFIG.ENDPOINTS.DEMO_MOVIMIENTOS(did), d),
    actualizar: (id, d) => api.post(CONFIG.ENDPOINTS.MOVIMIENTO_DEMO_ACTUALIZAR(id), d),
    eliminar: (id) => api.post(CONFIG.ENDPOINTS.MOVIMIENTO_DEMO_ELIMINAR(id)),
    reordenar: (did, ordenIds) => api.post(CONFIG.ENDPOINTS.DEMO_REORDENAR(did), { orden_ids: ordenIds }),
  },
  invitados: {
    cancelarAdmin: (idSesion) => api.post(CONFIG.ENDPOINTS.INVITADO_CANCELAR_ADMIN(idSesion)),
  },
  auditoria: {
    consultar: (params) => api.get(`${CONFIG.ENDPOINTS.AUDITORIA}?${params.toString()}`),
  },
};

// ---------------------------------------------------------------------------
// UTILIDADES DOM SEGURAS (100% textContent)
// ---------------------------------------------------------------------------
function crearBoton({ icono, texto, clase, accion, tipo, id, disabled = false, title = '' }) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = `btn btn-sm ${clase} me-1`;
  boton.dataset.accion = accion;
  if (tipo) boton.dataset.tipo = tipo;
  if (id !== undefined && id !== null) boton.dataset.id = String(id);
  boton.disabled = Boolean(disabled);
  if (title) boton.title = title;
  if (icono) {
    const i = document.createElement('i');
    i.className = `bi ${icono}${texto ? ' me-1' : ''}`;
    i.setAttribute('aria-hidden', 'true');
    boton.appendChild(i);
  }
  if (texto) boton.appendChild(document.createTextNode(texto));
  return boton;
}

function celda(valor, clase = '') {
  const td = document.createElement('td');
  if (clase) td.className = clase;
  td.textContent = vacio(valor) ? '—' : String(valor);
  return td;
}

function crearBadge(texto, clase) {
  const span = document.createElement('span');
  span.className = `badge ${clase}`;
  span.textContent = texto;
  return span;
}

function celdaBadge(texto, clase, tdClass = 'text-center') {
  const td = document.createElement('td');
  if (tdClass) td.className = tdClass;
  td.appendChild(crearBadge(texto, clase));
  return td;
}

function celdaEstado(activo) {
  return celdaBadge(
    esActivo(activo) ? 'Activo' : 'Inactivo',
    esActivo(activo)
      ? 'bg-success-subtle text-success border border-success-subtle'
      : 'bg-secondary-subtle text-secondary border border-secondary-subtle'
  );
}

function badgeEstadoComercial(estado) {
  const map = {
    DISPONIBLE: 'bg-info-subtle text-info border border-info-subtle',
    EXHIBICION: 'bg-primary-subtle text-primary border border-primary-subtle',
    VENDIDO: 'bg-warning-subtle text-warning border border-warning-subtle',
    INACTIVO: 'bg-secondary-subtle text-secondary border border-secondary-subtle',
  };
  return crearBadge(estado || '—', map[estado] || 'text-bg-secondary');
}

function crearIndicadorHardware(conectado) {
  const hwOn = conectado === true || conectado === 1;
  const span = document.createElement('span');
  span.className = `hw-indicator ${hwOn ? 'hw-indicator--online' : 'hw-indicator--offline'}`;
  span.title = hwOn ? 'ESP8266 en línea vía WebSocket' : 'ESP8266 sin señal activa';
  const dot = document.createElement('span');
  dot.className = 'hw-dot';
  dot.setAttribute('aria-hidden', 'true');
  span.append(dot, document.createTextNode(hwOn ? 'En línea' : 'Sin señal'));
  return span;
}

function crearMenuAcciones(items = []) {
  const wrap = document.createElement('div');
  wrap.className = 'dropdown d-inline-block';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn btn-sm btn-table-action btn-ghost-more';
  toggle.dataset.bsToggle = 'dropdown';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Más acciones');
  toggle.title = 'Más acciones';
  const dots = document.createElement('i');
  dots.className = 'bi bi-three-dots';
  dots.setAttribute('aria-hidden', 'true');
  toggle.appendChild(dots);

  const menu = document.createElement('ul');
  menu.className = 'dropdown-menu dropdown-menu-dark dropdown-menu-end admin-action-menu';

  items.forEach((item) => {
    const li = document.createElement('li');
    if (item.divider) {
      li.setAttribute('role', 'separator');
      const hr = document.createElement('hr');
      hr.className = 'dropdown-divider';
      li.appendChild(hr);
      menu.appendChild(li);
      return;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dropdown-item d-flex align-items-center gap-2${item.danger ? ' text-danger' : ''}`;
    btn.dataset.accion = item.accion;
    if (item.tipo) btn.dataset.tipo = item.tipo;
    if (item.id !== undefined && item.id !== null) btn.dataset.id = String(item.id);
    if (item.disabled) btn.disabled = true;
    if (item.title) btn.title = item.title;

    if (item.icono) {
      const ico = document.createElement('i');
      ico.className = `bi ${item.icono}`;
      ico.setAttribute('aria-hidden', 'true');
      btn.appendChild(ico);
    }
    const label = document.createElement('span');
    label.textContent = item.texto;
    btn.appendChild(label);
    li.appendChild(btn);
    menu.appendChild(li);
  });

  wrap.append(toggle, menu);
  if (window.bootstrap?.Dropdown) {
    new window.bootstrap.Dropdown(toggle, { popperConfig: { strategy: 'fixed' } });
  }
  return wrap;
}

function pintarMensajeEnTbody(tbodyId, texto, tono = 'secondary') {
  const tbody = $(tbodyId);
  if (!tbody) return;
  tbody.textContent = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = tbody.closest('table')?.tHead?.rows[0]?.cells.length || 6;
  td.className = `text-center small py-3 text-${tono}`;
  td.textContent = texto;
  tr.appendChild(td);
  tbody.appendChild(tr);
  UI.etiquetarCeldas(tbody);
}

function elegirSeleccion(ids, actual, preferido) {
  if (ids.includes(actual)) return actual;
  if (ids.includes(preferido)) return preferido;
  return ids.length ? ids[0] : null;
}

function formatearFechaHora(raw) {
  if (!raw) return '—';
  return String(raw).replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------------------
// 1. DASHBOARD ADMIN
// ---------------------------------------------------------------------------
async function cargarDashboard() {
  const res = await adminApi.dashboard();
  if (!res.ok) {
    toast(`No se pudo cargar el dashboard: ${formatApiError(res)}`, 'danger');
    return;
  }
  const d = res.data || {};
  ESTADO.dashboard = d;

  const setText = (id, val) => {
    const el = $(id);
    if (el) el.textContent = String(val ?? 0);
  };

  setText('kpiModelosActivos', `${d.modelos?.activos ?? 0} / ${d.modelos?.total ?? 0}`);
  setText('kpiVehiculosTotal', d.vehiculos_por_estado?.total ?? 0);
  setText('kpiVehDisponible', d.vehiculos_por_estado?.DISPONIBLE ?? 0);
  setText('kpiVehExhibicion', d.vehiculos_por_estado?.EXHIBICION ?? 0);
  setText('kpiVehVendido', d.vehiculos_por_estado?.VENDIDO ?? 0);
  setText('kpiVehInactivo', d.vehiculos_por_estado?.INACTIVO ?? 0);

  const usuariosPorRol = Array.isArray(d.usuarios_por_rol) ? d.usuarios_por_rol : [];
  const totalClientes = usuariosPorRol
    .filter((u) => u.rol === 'USUARIO')
    .reduce((acc, u) => acc + Number(u.activos || 0), 0);
  setText('kpiClientesActivos', totalClientes);
  setText('kpiSesionesInvitado', (d.sesiones_invitado_activas || []).length);
  setText('kpiSoportesActivos', (d.autorizaciones_soporte_activas || []).length);
  setText('kpiDispositivosOnline', (d.dispositivos_conectados_ids || []).length);

  // Sesiones de invitado activas
  const sesBody = $('dashSesionesBody');
  if (sesBody) {
    sesBody.textContent = '';
    const sesiones = d.sesiones_invitado_activas || [];
    if (!sesiones.length) {
      pintarMensajeEnTbody('dashSesionesBody', 'Sin sesiones de invitado activas en este momento.');
    } else {
      sesiones.forEach((s) => {
        const tr = document.createElement('tr');
        const tdAcc = document.createElement('td');
        tdAcc.className = 'text-end';
        tdAcc.appendChild(
          crearBoton({
            icono: 'bi-stop-circle',
            texto: 'Cancelar',
            clase: 'btn-outline-danger',
            accion: 'cancelar-sesion-invitado',
            tipo: 'sesion-invitado',
            id: s.id_sesion,
          })
        );
        tr.append(
          celda(`#${s.id_sesion}`, 'font-monospace text-center'),
          celda(`${s.vehiculo_nombre} (#${s.id_vehiculo})`),
          celda(s.identificador_invitado, 'font-monospace small'),
          celda(`${s.segundos_restantes ?? 0} s`, 'font-monospace text-center'),
          tdAcc
        );
        sesBody.appendChild(tr);
      });
      UI.etiquetarCeldas(sesBody);
    }
  }

  // Autorizaciones de soporte vigentes
  const sopBody = $('dashSoportesBody');
  if (sopBody) {
    sopBody.textContent = '';
    const soportes = d.autorizaciones_soporte_activas || [];
    if (!soportes.length) {
      pintarMensajeEnTbody('dashSoportesBody', 'Sin autorizaciones de soporte activas.');
    } else {
      soportes.forEach((a) => {
        const tr = document.createElement('tr');
        tr.append(
          celda(`${a.vehiculo_nombre} (#${a.id_vehiculo})`),
          celda(a.propietario_nombre),
          celda(a.motivo, 'small text-secondary'),
          celda(formatearFechaHora(a.fecha_expiracion), 'font-monospace small text-center')
        );
        sopBody.appendChild(tr);
      });
      UI.etiquetarCeldas(sopBody);
    }
  }

  // Últimos eventos de auditoría
  const audBody = $('dashAuditoriaBody');
  if (audBody) {
    audBody.textContent = '';
    const evs = d.ultimos_eventos_auditoria || [];
    if (!evs.length) {
      pintarMensajeEnTbody('dashAuditoriaBody', 'Sin eventos registrados.');
    } else {
      evs.forEach((e) => {
        const tr = document.createElement('tr');
        const tono =
          e.resultado === 'EXITO'
            ? 'bg-success-subtle text-success border border-success-subtle'
            : e.resultado === 'DENEGADO'
              ? 'bg-warning-subtle text-warning border border-warning-subtle'
              : 'bg-danger-subtle text-danger border border-danger-subtle';
        tr.append(
          celda(formatearFechaHora(e.fecha_hora), 'font-monospace small'),
          celdaBadge(e.rol_actor, claseRolAuditoria(e.rol_actor)),
          celda(e.accion, 'font-monospace small'),
          celda(formatearRecursoAuditoria(e), 'small'),
          celdaBadge(e.resultado, tono)
        );
        audBody.appendChild(tr);
      });
      UI.etiquetarCeldas(audBody);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. MODELOS Y CAPACIDADES
// ---------------------------------------------------------------------------
async function cargarModelos() {
  pintarMensajeEnTbody('adminModelosBody', 'Cargando modelos…');
  const res = await adminApi.modelos.listar();
  if (!res.ok) {
    ESTADO.modelos = [];
    pintarMensajeEnTbody('adminModelosBody', `Error: ${formatApiError(res)}`, 'danger');
    return;
  }
  ESTADO.modelos = lista(res);
  pintarModelos();
  poblarSelectModelos();
  await cargarCapacidades();
}

function pintarModelos() {
  const tbody = $('adminModelosBody');
  if (!tbody) return;
  tbody.textContent = '';
  if (!ESTADO.modelos.length) {
    pintarMensajeEnTbody('adminModelosBody', 'Sin modelos registrados.');
    return;
  }
  ESTADO.modelos.forEach((m) => {
    const tr = document.createElement('tr');
    const acciones = document.createElement('td');
    acciones.className = 'text-end text-nowrap';
    acciones.append(
      crearBoton({
        icono: 'bi-sliders',
        texto: 'Capacidades',
        clase: 'btn-table-action',
        accion: 'ver-capacidades',
        tipo: 'modelo',
        id: m.id_modelo,
      }),
      crearBoton({
        icono: 'bi-pencil-square',
        texto: 'Editar',
        clase: 'btn-table-action',
        accion: 'editar',
        tipo: 'modelo',
        id: m.id_modelo,
      }),
      crearBoton({
        icono: 'bi-trash',
        texto: 'Eliminar',
        clase: 'btn-table-action btn-table-action-danger',
        accion: 'eliminar',
        tipo: 'modelo',
        id: m.id_modelo,
      })
    );
    const tdNombreModelo = document.createElement('td');
    const wrapMod = document.createElement('div');
    wrapMod.className = 'd-flex align-items-center gap-2';
    const thumb = document.createElement('img');
    thumb.src = resolverImgModelo(m);
    thumb.alt = m.nombre_comercial || m.codigo_modelo;
    thumb.className = 'admin-model-thumb rounded border border-secondary-subtle';
    thumb.width = 48;
    thumb.height = 28;
    thumb.loading = 'lazy';
    thumb.addEventListener('error', () => {
      if (!thumb.dataset.fallbackApplied) {
        thumb.dataset.fallbackApplied = '1';
        thumb.src = DEFAULT_MODEL_IMG;
      }
    });
    const spanNom = document.createElement('span');
    spanNom.textContent = m.nombre_comercial;
    wrapMod.append(thumb, spanNom);
    tdNombreModelo.appendChild(wrapMod);

    tr.append(
      celda(m.id_modelo, 'text-center font-monospace'),
      celda(m.codigo_modelo, 'font-monospace'),
      tdNombreModelo,
      celda(m.descripcion, 'small text-secondary'),
      celdaEstado(m.activo),
      acciones
    );
    tbody.appendChild(tr);
  });
  UI.etiquetarCeldas(tbody);
}

function poblarSelectModelos() {
  const selectCap = $('adminModeloCapSelect');
  const selectVeh = $('vehiculoIdModelo');

  if (selectCap) {
    selectCap.textContent = '';
    if (!ESTADO.modelos.length) {
      selectCap.appendChild(new Option('Sin modelos', ''));
      selectCap.disabled = true;
      ESTADO.modeloId = null;
    } else {
      ESTADO.modelos.forEach((m) => {
        selectCap.appendChild(new Option(`${m.nombre_comercial} (${m.codigo_modelo})`, String(m.id_modelo)));
      });
      selectCap.disabled = false;
      ESTADO.modeloId = elegirSeleccion(
        ESTADO.modelos.map((m) => m.id_modelo),
        ESTADO.modeloId,
        ESTADO.modelos[0].id_modelo
      );
      selectCap.value = String(ESTADO.modeloId);
    }
  }

  if (selectVeh) {
    const prev = selectVeh.value;
    selectVeh.textContent = '';
    selectVeh.appendChild(new Option('— Sin modelo catalogado —', ''));
    ESTADO.modelos.forEach((m) => {
      selectVeh.appendChild(new Option(`${m.nombre_comercial} (${m.codigo_modelo})`, String(m.id_modelo)));
    });
    if (prev) selectVeh.value = prev;
  }
}

async function cargarCapacidades() {
  const mid = ESTADO.modeloId;
  const btnNueva = $('btnAdminNuevaCapacidad');
  if (btnNueva) btnNueva.disabled = !mid;
  if (!mid) {
    ESTADO.capacidades = [];
    pintarMensajeEnTbody('adminCapacidadesBody', 'Selecciona un modelo para ver sus capacidades.');
    return;
  }
  pintarMensajeEnTbody('adminCapacidadesBody', 'Cargando capacidades…');
  const res = await adminApi.capacidades.listar(mid);
  if (!res.ok) {
    ESTADO.capacidades = [];
    pintarMensajeEnTbody('adminCapacidadesBody', `Error: ${formatApiError(res)}`, 'danger');
    return;
  }
  ESTADO.capacidades = lista(res);
  const tbody = $('adminCapacidadesBody');
  tbody.textContent = '';
  if (!ESTADO.capacidades.length) {
    pintarMensajeEnTbody('adminCapacidadesBody', 'Este modelo aún no tiene capacidades físicas.');
    return;
  }
  ESTADO.capacidades.forEach((c) => {
    const tr = document.createElement('tr');
    const acciones = document.createElement('td');
    acciones.className = 'text-end text-nowrap';
    acciones.append(
      crearBoton({
        icono: 'bi-pencil-square',
        texto: 'Editar',
        clase: 'btn-table-action',
        accion: 'editar',
        tipo: 'capacidad',
        id: c.id_capacidad,
      }),
      crearBoton({
        icono: 'bi-trash',
        texto: 'Eliminar',
        clase: 'btn-table-action btn-table-action-danger',
        accion: 'eliminar',
        tipo: 'capacidad',
        id: c.id_capacidad,
      })
    );
    tr.append(
      celda(c.codigo_fisico, 'text-center font-monospace'),
      celda(c.nombre_base),
      celdaBadge(
        esActivo(c.permite_temporizado) ? 'Sí' : 'No',
        esActivo(c.permite_temporizado)
          ? 'bg-info-subtle text-info border border-info-subtle'
          : 'bg-secondary-subtle text-secondary border border-secondary-subtle'
      ),
      celdaBadge(
        esActivo(c.permitido_invitado_default) ? 'Sí' : 'No',
        esActivo(c.permitido_invitado_default)
          ? 'bg-primary-subtle text-primary border border-primary-subtle'
          : 'bg-secondary-subtle text-secondary border border-secondary-subtle'
      ),
      celdaEstado(c.activo),
      acciones
    );
    tbody.appendChild(tr);
  });
  UI.etiquetarCeldas(tbody);
}

// ---------------------------------------------------------------------------
// 3. UNIDADES (VEHÍCULOS) + ASIGNACIONES
// ---------------------------------------------------------------------------
async function cargarVehiculos() {
  pintarMensajeEnTbody('adminVehiculosBody', 'Cargando unidades…');
  const res = await adminApi.vehiculos.listar(ESTADO.filtroEstadoVehiculo);
  if (!res.ok) {
    ESTADO.vehiculos = [];
    pintarMensajeEnTbody('adminVehiculosBody', `Error: ${formatApiError(res)}`, 'danger');
    poblarSelectorVehiculos('Error al cargar');
    return;
  }
  ESTADO.vehiculos = lista(res);
  pintarVehiculos();
  poblarSelectorVehiculos();
  await cargarDatosVehiculo();
}

function pintarVehiculos() {
  const tbody = $('adminVehiculosBody');
  if (!tbody) return;
  tbody.textContent = '';
  if (!ESTADO.vehiculos.length) {
    pintarMensajeEnTbody('adminVehiculosBody', 'Sin unidades registradas para el filtro actual.');
    return;
  }
  ESTADO.vehiculos.forEach((v) => {
    const tr = document.createElement('tr');
    const tdEstado = document.createElement('td');
    tdEstado.className = 'text-center';
    const estadoWrap = document.createElement('div');
    estadoWrap.className = 'd-inline-flex flex-wrap align-items-center justify-content-center gap-2';
    estadoWrap.appendChild(badgeEstadoComercial(v.estado_comercial));
    const esUnidadPropiedadCliente =
      v.estado_comercial === 'VENDIDO' || (v.id_propietario !== null && v.id_propietario !== undefined);

    if (esUnidadPropiedadCliente && v.soporte_activo) {
      estadoWrap.appendChild(
        crearBadge('Soporte OK', 'bg-success-subtle text-success border border-success-subtle')
      );
    }
    estadoWrap.appendChild(crearIndicadorHardware(v.dispositivo_conectado));
    tdEstado.appendChild(estadoWrap);

    const propietarioTexto = v.propietario_nombre
      ? `${v.propietario_nombre} (#${v.id_propietario})`
      : 'Empresa';

    const puedeOperar =
      esActivo(v.activo) &&
      v.estado_comercial !== 'INACTIVO' &&
      (!esUnidadPropiedadCliente || Boolean(v.soporte_activo));

    const acciones = document.createElement('td');
    acciones.className = 'text-end text-nowrap';
    acciones.append(
      crearBoton({
        icono: 'bi-controller',
        texto: 'Operar',
        clase: puedeOperar ? 'btn-table-action btn-table-action-accent' : 'btn-table-action',
        accion: 'operar-vehiculo',
        tipo: 'vehiculo',
        id: v.id_vehiculo,
        title: puedeOperar
          ? 'Seleccionar unidad y abrir Control'
          : 'Unidad VENDIDO sin soporte vigente o inactiva (403)',
      }),
      crearBoton({
        icono: 'bi-pencil-square',
        texto: 'Editar',
        clase: 'btn-table-action',
        accion: 'editar',
        tipo: 'vehiculo',
        id: v.id_vehiculo,
      }),
      crearMenuAcciones([
        {
          icono: 'bi-person-check',
          texto: 'Asignar propietario',
          accion: 'asignar-propietario',
          tipo: 'vehiculo',
          id: v.id_vehiculo,
        },
        {
          icono: 'bi-clock-history',
          texto: 'Historial de propietarios',
          accion: 'ver-historial-propietarios',
          tipo: 'vehiculo',
          id: v.id_vehiculo,
        },
        { divider: true },
        {
          icono: 'bi-trash',
          texto: 'Dar de baja',
          accion: 'eliminar',
          tipo: 'vehiculo',
          id: v.id_vehiculo,
          danger: true,
        },
      ])
    );

    tr.append(
      celda(v.id_vehiculo, 'text-center font-monospace'),
      celda(v.nombre),
      celda(v.nombre_comercial || v.modelo),
      celda(v.numero_serie, 'font-monospace small'),
      celda(propietarioTexto, 'small'),
      tdEstado,
      celdaEstado(v.activo),
      acciones
    );
    tbody.appendChild(tr);
  });
  UI.etiquetarCeldas(tbody);
}

function poblarSelectorVehiculos(textoVacio = 'Sin unidades') {
  const select = $('adminVehiculoSelect');
  if (!select) return;
  select.textContent = '';
  if (!ESTADO.vehiculos.length) {
    select.appendChild(new Option(textoVacio, ''));
    select.disabled = true;
    ESTADO.vehiculoId = null;
    return;
  }
  ESTADO.vehiculos.forEach((v) => {
    select.appendChild(
      new Option(`${v.nombre} (#${v.id_vehiculo} · ${v.estado_comercial})`, String(v.id_vehiculo))
    );
  });
  select.disabled = false;
  ESTADO.vehiculoId = elegirSeleccion(
    ESTADO.vehiculos.map((v) => v.id_vehiculo),
    ESTADO.vehiculoId,
    CONFIG.VEHICLE_ID
  );
  select.value = String(ESTADO.vehiculoId);
}

// ---------------------------------------------------------------------------
// 4. CLIENTES / USUARIOS
// ---------------------------------------------------------------------------
async function cargarUsuarios() {
  pintarMensajeEnTbody('adminUsuariosBody', 'Cargando usuarios…');
  const res = await adminApi.usuarios.listar();
  if (!res.ok) {
    ESTADO.usuarios = [];
    pintarMensajeEnTbody('adminUsuariosBody', `Error: ${formatApiError(res)}`, 'danger');
    return;
  }
  ESTADO.usuarios = lista(res);
  pintarUsuarios();
  poblarSelectClientesAsignacion();
}

function pintarUsuarios() {
  const tbody = $('adminUsuariosBody');
  if (!tbody) return;
  tbody.textContent = '';
  if (!ESTADO.usuarios.length) {
    pintarMensajeEnTbody('adminUsuariosBody', 'Sin usuarios registrados.');
    return;
  }
  ESTADO.usuarios.forEach((u) => {
    const tr = document.createElement('tr');
    const esCuentaInvitado = u.rol === 'INVITADO';
    const rolClase =
      u.rol === 'ADMIN'
        ? 'bg-warning-subtle text-warning border border-warning-subtle'
        : u.rol === 'USUARIO'
          ? 'bg-info-subtle text-info border border-info-subtle'
          : 'bg-secondary-subtle text-secondary border border-secondary-subtle';

    const acciones = document.createElement('td');
    acciones.className = 'text-end text-nowrap';
    if (esCuentaInvitado) {
      const lockBadge = document.createElement('span');
      lockBadge.className = 'badge bg-dark text-secondary border border-secondary-subtle';
      const icoLock = document.createElement('i');
      icoLock.className = 'bi bi-lock-fill me-1';
      icoLock.setAttribute('aria-hidden', 'true');
      lockBadge.append(icoLock, document.createTextNode('Cuenta de sistema'));
      acciones.appendChild(lockBadge);
    } else {
      acciones.append(
        crearBoton({
          icono: 'bi-pencil-square',
          texto: 'Editar',
          clase: 'btn-table-action',
          accion: 'editar',
          tipo: 'usuario',
          id: u.id_usuario,
        }),
        crearBoton({
          icono: 'bi-person-slash',
          texto: 'Desactivar',
          clase: 'btn-table-action btn-table-action-danger',
          accion: 'desactivar-usuario',
          tipo: 'usuario',
          id: u.id_usuario,
          disabled: !esActivo(u.activo),
        })
      );
    }
    tr.append(
      celda(u.id_usuario, 'text-center font-monospace'),
      celda(u.nombre),
      celda(u.correo, 'font-monospace small'),
      celdaBadge(esCuentaInvitado ? 'INVITADO · Sistema' : u.rol, rolClase),
      celdaEstado(u.activo),
      acciones
    );
    tbody.appendChild(tr);
  });
  UI.etiquetarCeldas(tbody);
}

function poblarSelectClientesAsignacion() {
  const select = $('asignarPropietarioSelect');
  if (!select) return;
  select.textContent = '';
  select.appendChild(new Option('— Sin propietario (devolver a Empresa) —', ''));
  ESTADO.usuarios
    .filter((u) => u.rol === 'USUARIO' && esActivo(u.activo))
    .forEach((u) => {
      select.appendChild(new Option(`${u.nombre} (${u.correo})`, String(u.id_usuario)));
    });
}

// ---------------------------------------------------------------------------
// 5. COMANDOS V2 (BASE vs TEMPORIZADOS) + DEMOS + PASOS
// ---------------------------------------------------------------------------
async function cargarDatosVehiculo() {
  if (!ESTADO.vehiculoId) {
    ESTADO.comandos = [];
    ESTADO.demos = [];
    ESTADO.pasos = [];
    pintarMensajeEnTbody('adminComandosBody', 'Selecciona una unidad.');
    pintarMensajeEnTbody('adminDemosBody', 'Selecciona una unidad.');
    pintarMensajeEnTbody('adminPasosBody', 'Selecciona una demo.');
    poblarSelectDemos();
    return;
  }
  await Promise.all([cargarComandos(), cargarDemos()]);
  await cargarPasos();
}

async function cargarComandos() {
  const vid = ESTADO.vehiculoId;
  if (!vid) return;
  pintarMensajeEnTbody('adminComandosBody', 'Cargando comandos…');
  const res = await adminApi.comandos.listar(vid);
  if (vid !== ESTADO.vehiculoId) return;
  if (!res.ok) {
    ESTADO.comandos = [];
    pintarMensajeEnTbody('adminComandosBody', `Error: ${formatApiError(res)}`, 'danger');
    return;
  }
  ESTADO.comandos = lista(res).sort((a, b) => Number(a.codigo) - Number(b.codigo));
  const tbody = $('adminComandosBody');
  tbody.textContent = '';
  if (!ESTADO.comandos.length) {
    pintarMensajeEnTbody('adminComandosBody', 'Sin comandos registrados en esta unidad.');
    return;
  }
  ESTADO.comandos.forEach((c) => {
    const tr = document.createElement('tr');
    const esTemporizado = c.duracion_ms !== null && c.duracion_ms !== undefined && Number(c.duracion_ms) > 0;
    const tipoBadge = esTemporizado
      ? celdaBadge(`Temporizado · ${c.duracion_ms} ms`, 'bg-info-subtle text-info border border-info-subtle')
      : celdaBadge('Base · continuo', 'bg-dark text-light border border-secondary');

    const acciones = document.createElement('td');
    acciones.className = 'text-end text-nowrap';
    acciones.append(
      crearBoton({
        icono: 'bi-pencil-square',
        texto: 'Editar',
        clase: 'btn-table-action',
        accion: 'editar',
        tipo: 'comando',
        id: c.id_comando,
      }),
      crearBoton({
        icono: 'bi-trash',
        texto: 'Eliminar',
        clase: 'btn-table-action btn-table-action-danger',
        accion: 'eliminar',
        tipo: 'comando',
        id: c.id_comando,
      })
    );

    tr.append(
      celda(c.codigo, 'text-center font-monospace'),
      celda(c.codigo_fisico ?? c.codigo, 'text-center font-monospace'),
      celda(c.nombre),
      tipoBadge,
      celdaBadge(
        esActivo(c.permitido_invitado) ? 'Sí' : 'No',
        esActivo(c.permitido_invitado)
          ? 'bg-primary-subtle text-primary border border-primary-subtle'
          : 'bg-secondary-subtle text-secondary border border-secondary-subtle'
      ),
      celdaEstado(c.activo),
      acciones
    );
    tbody.appendChild(tr);
  });
  UI.etiquetarCeldas(tbody);
}

async function cargarDemos() {
  const vid = ESTADO.vehiculoId;
  if (!vid) return;
  pintarMensajeEnTbody('adminDemosBody', 'Cargando demos…');
  const res = await adminApi.demos.listar(vid);
  if (vid !== ESTADO.vehiculoId) return;
  if (!res.ok) {
    ESTADO.demos = [];
    pintarMensajeEnTbody('adminDemosBody', `Error: ${formatApiError(res)}`, 'danger');
    poblarSelectDemos();
    return;
  }
  ESTADO.demos = lista(res);
  const tbody = $('adminDemosBody');
  tbody.textContent = '';
  if (!ESTADO.demos.length) {
    pintarMensajeEnTbody('adminDemosBody', 'Sin demos registradas en esta unidad.');
  } else {
    ESTADO.demos.forEach((d) => {
      const tr = document.createElement('tr');
      const esPrivada = d.tipo === 'PRIVADA';
      const acciones = document.createElement('td');
      acciones.className = 'text-end text-nowrap';
      acciones.append(
        crearBoton({
          icono: 'bi-list-ol',
          texto: 'Pasos',
          clase: 'btn-table-action btn-table-action-accent',
          accion: 'ver-pasos',
          tipo: 'demo',
          id: d.id_demo,
        }),
        crearBoton({
          icono: 'bi-pencil-square',
          texto: 'Editar',
          clase: 'btn-table-action',
          accion: 'editar',
          tipo: 'demo',
          id: d.id_demo,
          disabled: esPrivada,
          title: esPrivada ? 'Las demos PRIVADA de compradores son de solo lectura para ADMIN' : '',
        }),
        crearBoton({
          icono: 'bi-trash',
          texto: 'Eliminar',
          clase: 'btn-table-action btn-table-action-danger',
          accion: 'eliminar',
          tipo: 'demo',
          id: d.id_demo,
          disabled: esPrivada,
          title: esPrivada ? 'Las demos PRIVADA no pueden eliminarse desde ADMIN' : '',
        })
      );
      tr.append(
        celda(d.id_demo, 'text-center font-monospace'),
        celda(d.nombre),
        celdaBadge(
          d.tipo || 'FABRICA',
          esPrivada
            ? 'bg-warning-subtle text-warning border border-warning-subtle'
            : 'bg-info-subtle text-info border border-info-subtle'
        ),
        celda(d.descripcion, 'small text-secondary'),
        celdaEstado(d.activo),
        acciones
      );
      tbody.appendChild(tr);
    });
    UI.etiquetarCeldas(tbody);
  }
  poblarSelectDemos();
}

function poblarSelectDemos() {
  const select = $('adminDemoSelect');
  if (!select) return;
  select.textContent = '';
  if (!ESTADO.demos.length) {
    ESTADO.demoId = null;
    select.appendChild(new Option('Sin demos', ''));
    select.disabled = true;
    return;
  }
  ESTADO.demos.forEach((d) => {
    select.appendChild(new Option(`${d.nombre} (#${d.id_demo} · ${d.tipo || 'FABRICA'})`, String(d.id_demo)));
  });
  select.disabled = false;
  ESTADO.demoId = elegirSeleccion(
    ESTADO.demos.map((d) => d.id_demo),
    ESTADO.demoId,
    null
  );
  select.value = String(ESTADO.demoId);
}

async function cargarPasos() {
  const demoId = ESTADO.demoId;
  const demoObj = ESTADO.demos.find((d) => d.id_demo === demoId);
  const soloLectura = demoObj?.tipo === 'PRIVADA';
  const botonNuevo = $('btnAdminNuevoPaso');
  if (botonNuevo) botonNuevo.disabled = !demoId || soloLectura;

  const generacion = ++generacionPasos;
  if (!demoId) {
    ESTADO.pasos = [];
    pintarMensajeEnTbody('adminPasosBody', 'Selecciona una demo para ver sus pasos.');
    return;
  }

  pintarMensajeEnTbody('adminPasosBody', 'Cargando pasos…');
  const res = await adminApi.pasos.listar(demoId);
  if (generacion !== generacionPasos) return;
  if (!res.ok) {
    ESTADO.pasos = [];
    pintarMensajeEnTbody('adminPasosBody', `Error: ${formatApiError(res)}`, 'danger');
    return;
  }
  ESTADO.pasos = lista(res).sort((a, b) => Number(a.orden) - Number(b.orden));
  const tbody = $('adminPasosBody');
  tbody.textContent = '';
  if (!ESTADO.pasos.length) {
    pintarMensajeEnTbody('adminPasosBody', 'Sin pasos registrados.');
    return;
  }
  ESTADO.pasos.forEach((p, idx) => {
    const tr = document.createElement('tr');
    const nombreCmd = p.comando
      ? `${p.comando} (fís. ${p.codigo_fisico ?? p.codigo})`
      : `Comando #${p.id_comando}`;
    const acciones = document.createElement('td');
    acciones.className = 'text-end text-nowrap';
    acciones.append(
      crearBoton({
        icono: 'bi-arrow-up',
        texto: '',
        clase: 'btn-table-action',
        accion: 'subir-paso',
        tipo: 'paso',
        id: p.id_demo_movimiento,
        disabled: soloLectura || idx === 0,
        title: 'Subir orden',
      }),
      crearBoton({
        icono: 'bi-arrow-down',
        texto: '',
        clase: 'btn-table-action',
        accion: 'bajar-paso',
        tipo: 'paso',
        id: p.id_demo_movimiento,
        disabled: soloLectura || idx === ESTADO.pasos.length - 1,
        title: 'Bajar orden',
      }),
      crearBoton({
        icono: 'bi-pencil-square',
        texto: 'Editar',
        clase: 'btn-table-action',
        accion: 'editar',
        tipo: 'paso',
        id: p.id_demo_movimiento,
        disabled: soloLectura,
      }),
      crearBoton({
        icono: 'bi-trash',
        texto: 'Eliminar',
        clase: 'btn-table-action btn-table-action-danger',
        accion: 'eliminar',
        tipo: 'paso',
        id: p.id_demo_movimiento,
        disabled: soloLectura,
      })
    );
    tr.append(
      celda(p.orden, 'text-center font-monospace'),
      celda(nombreCmd),
      celda(`${p.duracion_ms} ms`, 'text-center font-monospace'),
      celda(`${p.pausa_ms} ms`, 'text-center font-monospace'),
      acciones
    );
    tbody.appendChild(tr);
  });
  UI.etiquetarCeldas(tbody);
}

async function moverPaso(idMov, delta) {
  const ids = ESTADO.pasos.map((p) => p.id_demo_movimiento);
  const idx = ids.indexOf(idMov);
  const target = idx + delta;
  if (idx < 0 || target < 0 || target >= ids.length) return;
  [ids[idx], ids[target]] = [ids[target], ids[idx]];

  const res = await adminApi.pasos.reordenar(ESTADO.demoId, ids);
  if (!res.ok) {
    toast(`Error al reordenar: ${formatApiError(res)}`, 'danger');
    return;
  }
  toast('Orden de pasos actualizado.', 'success');
  await cargarPasos();
}

// ---------------------------------------------------------------------------
// 6. BITÁCORA DE AUDITORÍA (filtrable y paginada)
// ---------------------------------------------------------------------------
function claseRolAuditoria(rol) {
  if (rol === 'INVITADO') return 'bg-info-subtle text-info border border-info-subtle';
  if (rol === 'ADMIN') return 'bg-warning-subtle text-warning border border-warning-subtle';
  if (rol === 'USUARIO') return 'bg-primary-subtle text-primary border border-primary-subtle';
  return 'text-bg-dark border border-secondary';
}

function formatearActorAuditoria(a) {
  const det = a.detalle_json && typeof a.detalle_json === 'object' ? a.detalle_json : null;
  if (a.rol_actor === 'INVITADO') {
    if (det?.id_sesion) return `Invitado · Sesión #${det.id_sesion}`;
    if (det?.identificador) return `Invitado (${det.identificador})`;
    return 'Invitado (Exhibición)';
  }
  if (a.nombre_actor) return `${a.nombre_actor} (#${a.id_actor})`;
  return a.id_actor ? `Usuario #${a.id_actor}` : 'Sistema';
}

function formatearRecursoAuditoria(a) {
  const det = a.detalle_json && typeof a.detalle_json === 'object' ? a.detalle_json : null;
  const vid = a.vehiculo_id ?? det?.id_vehiculo ?? null;
  const vnom = a.vehiculo_nombre || det?.vehiculo || null;
  const unidadTexto = vnom ? (vid ? `${vnom} (#${vid})` : vnom) : vid ? `Vehículo #${vid}` : '';
  if (a.recurso_tipo === 'VEHICULO' && unidadTexto) return unidadTexto;
  const base = `${a.recurso_tipo}${a.recurso_id ? ` #${a.recurso_id}` : ''}`;
  return unidadTexto ? `${base} · ${unidadTexto}` : base;
}

function formatearDetalleAuditoria(a) {
  const det = a.detalle_json && typeof a.detalle_json === 'object' ? a.detalle_json : null;
  if (!det) return typeof a.detalle_json === 'string' && a.detalle_json ? a.detalle_json : '—';
  const partes = [];
  if (det.vehiculo || det.id_vehiculo) {
    partes.push(`Unidad: ${det.vehiculo || `#${det.id_vehiculo}`}`);
  }
  if (det.comando) {
    partes.push(
      `Comando: ${det.comando}${det.codigo_fisico !== undefined ? ` (fís. ${det.codigo_fisico})` : ''}`
    );
  }
  if (det.nombre_demo) partes.push(`Demo: ${det.nombre_demo}`);
  if (det.id_sesion) partes.push(`Sesión #${det.id_sesion}`);
  if (det.motivo) partes.push(`Motivo: ${det.motivo}`);
  const omitir = new Set([
    'vehiculo',
    'id_vehiculo',
    'comando',
    'codigo_fisico',
    'nombre_demo',
    'id_sesion',
    'motivo',
    'identificador',
    'id_comando',
  ]);
  Object.entries(det).forEach(([k, v]) => {
    if (omitir.has(k) || v === null || v === undefined || v === '') return;
    partes.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  });
  return partes.length ? partes.join(' · ') : '—';
}

async function cargarAuditoria(resetOffset = false) {
  if (resetOffset) ESTADO.auditoria.offset = 0;

  const params = new URLSearchParams();
  params.set('limit', String(ESTADO.auditoria.limit));
  params.set('offset', String(ESTADO.auditoria.offset));

  const fDesde = $('audFechaDesde')?.value?.trim();
  const fHasta = $('audFechaHasta')?.value?.trim();
  const rol = $('audRol')?.value?.trim();
  const resultado = $('audResultado')?.value?.trim();
  const accion = $('audAccion')?.value?.trim();
  const recurso = $('audRecurso')?.value?.trim();

  if (fDesde) params.set('fecha_desde', fDesde);
  if (fHasta) params.set('fecha_hasta', fHasta);
  if (rol) params.set('rol_actor', rol);
  if (resultado) params.set('resultado', resultado);
  if (accion) params.set('accion', accion);
  if (recurso) params.set('recurso_tipo', recurso);

  pintarMensajeEnTbody('adminAuditoriaBody', 'Consultando bitácora…');
  const res = await adminApi.auditoria.consultar(params);
  if (!res.ok) {
    pintarMensajeEnTbody('adminAuditoriaBody', `Error: ${formatApiError(res)}`, 'danger');
    return;
  }

  const data = res.data || {};
  ESTADO.auditoria.items = Array.isArray(data.items) ? data.items : [];
  ESTADO.auditoria.total = Number(data.total || 0);

  const info = $('audPaginacionInfo');
  if (info) {
    const inicio = ESTADO.auditoria.total === 0 ? 0 : ESTADO.auditoria.offset + 1;
    const fin = Math.min(ESTADO.auditoria.offset + ESTADO.auditoria.items.length, ESTADO.auditoria.total);
    info.textContent = `Mostrando ${inicio}–${fin} de ${ESTADO.auditoria.total} eventos`;
  }
  const btnPrev = $('btnAudPrev');
  const btnNext = $('btnAudNext');
  if (btnPrev) btnPrev.disabled = ESTADO.auditoria.offset <= 0;
  if (btnNext) {
    btnNext.disabled = ESTADO.auditoria.offset + ESTADO.auditoria.limit >= ESTADO.auditoria.total;
  }

  const tbody = $('adminAuditoriaBody');
  tbody.textContent = '';
  if (!ESTADO.auditoria.items.length) {
    pintarMensajeEnTbody('adminAuditoriaBody', 'Sin eventos de auditoría con los filtros aplicados.');
    return;
  }

  ESTADO.auditoria.items.forEach((a) => {
    const tr = document.createElement('tr');
    const actor = formatearActorAuditoria(a);
    const resClase =
      a.resultado === 'EXITO'
        ? 'bg-success-subtle text-success border border-success-subtle'
        : a.resultado === 'DENEGADO'
          ? 'bg-warning-subtle text-warning border border-warning-subtle'
          : 'bg-danger-subtle text-danger border border-danger-subtle';

    tr.append(
      celda(formatearFechaHora(a.fecha_hora), 'font-monospace small'),
      celda(actor, 'small'),
      celdaBadge(a.rol_actor, claseRolAuditoria(a.rol_actor)),
      celda(a.accion, 'font-monospace small'),
      celda(formatearRecursoAuditoria(a), 'small'),
      celdaBadge(a.resultado, resClase),
      celda(formatearDetalleAuditoria(a), 'small text-secondary text-break')
    );
    tbody.appendChild(tr);
  });
  UI.etiquetarCeldas(tbody);
}

// ---------------------------------------------------------------------------
// FORMULARIOS MODALES (Modelo, Capacidad, Vehículo, Asignar, Usuario, Comando, Demo, Paso)
// ---------------------------------------------------------------------------
function leerTexto(form, name) {
  return String(form.elements[name]?.value ?? '').trim();
}

function leerEntero(form, name) {
  const raw = leerTexto(form, name);
  if (raw === '') return NaN;
  const n = Number(raw);
  return Number.isInteger(n) ? n : NaN;
}

function abrirModalModelo(item = null) {
  const form = $('formModelo');
  const editando = Boolean(item);
  form.reset();
  form.elements.id.value = editando ? String(item.id_modelo) : '';
  $('modalModeloTitulo').textContent = editando ? 'Editar modelo' : 'Nuevo modelo';
  form.elements.codigo_modelo.value = editando ? item.codigo_modelo || '' : '';
  form.elements.nombre_comercial.value = editando ? item.nombre_comercial || '' : '';
  form.elements.descripcion.value = editando ? item.descripcion || '' : '';
  form.elements.url_imagen.value = editando ? item.url_imagen || '' : '';
  form.elements.activo.checked = editando ? esActivo(item.activo) : true;
  bootstrap.Modal.getOrCreateInstance($('modalModelo')).show();
}

function abrirModalCapacidad(item = null) {
  if (!ESTADO.modeloId) {
    toast('Selecciona primero un modelo.', 'warning');
    return;
  }
  const form = $('formCapacidad');
  const editando = Boolean(item);
  form.reset();
  form.elements.id.value = editando ? String(item.id_capacidad) : '';
  $('modalCapacidadTitulo').textContent = editando ? 'Editar capacidad' : 'Nueva capacidad física';
  form.elements.codigo_fisico.value = editando ? String(item.codigo_fisico) : '';
  form.elements.nombre_base.value = editando ? item.nombre_base || '' : '';
  form.elements.descripcion.value = editando ? item.descripcion || '' : '';
  form.elements.permite_temporizado.checked = editando ? esActivo(item.permite_temporizado) : true;
  form.elements.permitido_invitado_default.checked = editando
    ? esActivo(item.permitido_invitado_default)
    : false;
  form.elements.activo.checked = editando ? esActivo(item.activo) : true;
  bootstrap.Modal.getOrCreateInstance($('modalCapacidad')).show();
}

function abrirModalVehiculo(item = null) {
  poblarSelectModelos();
  const form = $('formVehiculo');
  const editando = Boolean(item);
  form.reset();
  form.elements.id.value = editando ? String(item.id_vehiculo) : '';
  $('modalVehiculoTitulo').textContent = editando ? 'Editar unidad física' : 'Nueva unidad física';
  form.elements.nombre.value = editando ? item.nombre || '' : '';
  form.elements.id_modelo.value = editando && item.id_modelo ? String(item.id_modelo) : '';
  form.elements.modelo.value = editando ? item.modelo || '' : '';
  form.elements.numero_serie.value = editando ? item.numero_serie || '' : '';
  form.elements.microcontrolador.value = editando ? item.microcontrolador || '' : 'ESP8266';
  form.elements.estado_comercial.value = editando ? item.estado_comercial || 'DISPONIBLE' : 'DISPONIBLE';
  form.elements.descripcion.value = editando ? item.descripcion || '' : '';
  $('wrapActivoVehiculo').hidden = !editando;
  form.elements.activo.checked = editando ? esActivo(item.activo) : true;
  bootstrap.Modal.getOrCreateInstance($('modalVehiculo')).show();
}

function abrirModalAsignar(vehiculo) {
  poblarSelectClientesAsignacion();
  const form = $('formAsignarPropietario');
  form.reset();
  form.elements.id_vehiculo.value = String(vehiculo.id_vehiculo);
  $('asignarVehiculoNombre').textContent = `${vehiculo.nombre} (#${vehiculo.id_vehiculo})`;
  form.elements.id_nuevo_propietario.value = vehiculo.id_propietario ? String(vehiculo.id_propietario) : '';
  form.elements.nuevo_estado_comercial.value = vehiculo.id_propietario ? 'VENDIDO' : 'DISPONIBLE';
  form.elements.motivo.value = '';
  bootstrap.Modal.getOrCreateInstance($('modalAsignarPropietario')).show();
}

async function abrirHistorialPropietarios(vehiculo) {
  $('modalPropHistorialTitulo').textContent = `Historial de propietarios · ${vehiculo.nombre} (#${vehiculo.id_vehiculo})`;
  pintarMensajeEnTbody('adminPropHistorialBody', 'Consultando historial…');
  bootstrap.Modal.getOrCreateInstance($('modalPropHistorial')).show();

  const res = await adminApi.vehiculos.historialPropietarios(vehiculo.id_vehiculo);
  if (!res.ok) {
    pintarMensajeEnTbody('adminPropHistorialBody', `Error: ${formatApiError(res)}`, 'danger');
    return;
  }
  const rows = lista(res);
  const tbody = $('adminPropHistorialBody');
  tbody.textContent = '';
  if (!rows.length) {
    pintarMensajeEnTbody('adminPropHistorialBody', 'Sin asignaciones registradas.');
    return;
  }
  rows.forEach((h) => {
    const tr = document.createElement('tr');
    tr.append(
      celda(formatearFechaHora(h.fecha_asignacion), 'font-monospace small'),
      celda(h.nombre_anterior || 'Empresa', 'small'),
      celda(h.nombre_nuevo || 'Empresa', 'small'),
      celda(h.asignado_por_nombre || `#${h.asignado_por}`, 'small'),
      celda(h.motivo, 'small text-secondary')
    );
    tbody.appendChild(tr);
  });
  UI.etiquetarCeldas(tbody);
}

function abrirModalUsuario(item = null) {
  const form = $('formUsuario');
  const editando = Boolean(item);
  form.reset();
  form.elements.id.value = editando ? String(item.id_usuario) : '';
  $('modalUsuarioTitulo').textContent = editando ? 'Editar usuario' : 'Nuevo usuario';
  form.elements.nombre.value = editando ? item.nombre || '' : '';
  form.elements.correo.value = editando ? item.correo || '' : '';
  form.elements.rol.value = editando ? item.rol || 'USUARIO' : 'USUARIO';
  form.elements.password.value = '';
  form.elements.password.required = !editando;
  $('usuarioPasswordHint').textContent = editando
    ? 'Déjalo vacío para mantener la contraseña actual (cambiarla cerrará sus sesiones activas).'
    : 'Mínimo 8 caracteres. Se almacenará con bcrypt.';
  form.elements.activo.checked = editando ? esActivo(item.activo) : true;
  bootstrap.Modal.getOrCreateInstance($('modalUsuario')).show();
}

function sincronizarTipoComandoForm() {
  const form = $('formComando');
  const esTemp = form.elements.es_temporizado.checked;
  $('wrapComandoDuracion').hidden = !esTemp;
  form.elements.duracion_ms.required = esTemp;
  if (!esTemp) form.elements.duracion_ms.value = '';
}

function abrirModalComando(item = null) {
  if (!ESTADO.vehiculoId) {
    toast('Selecciona primero una unidad.', 'warning');
    return;
  }
  const form = $('formComando');
  const editando = Boolean(item);
  form.reset();
  form.elements.id.value = editando ? String(item.id_comando) : '';
  $('modalComandoTitulo').textContent = editando ? 'Editar comando' : 'Nuevo comando';
  form.elements.nombre.value = editando ? item.nombre || '' : '';
  form.elements.codigo.value = editando ? String(item.codigo) : '';
  form.elements.codigo_fisico.value = editando ? String(item.codigo_fisico ?? item.codigo) : '';
  form.elements.descripcion.value = editando ? item.descripcion || '' : '';

  const esTemp = editando && item.duracion_ms !== null && item.duracion_ms !== undefined && Number(item.duracion_ms) > 0;
  form.elements.es_temporizado.checked = esTemp;
  form.elements.duracion_ms.value = esTemp ? String(item.duracion_ms) : '';
  form.elements.permitido_invitado.checked = editando ? esActivo(item.permitido_invitado) : false;
  $('wrapActivoComando').hidden = !editando;
  form.elements.activo.checked = editando ? esActivo(item.activo) : true;
  sincronizarTipoComandoForm();

  bootstrap.Modal.getOrCreateInstance($('modalComando')).show();
}

function abrirModalDemo(item = null) {
  if (!ESTADO.vehiculoId) {
    toast('Selecciona primero una unidad.', 'warning');
    return;
  }
  const form = $('formDemo');
  const editando = Boolean(item);
  form.reset();
  form.elements.id.value = editando ? String(item.id_demo) : '';
  $('modalDemoTitulo').textContent = editando ? 'Editar demo de fábrica' : 'Nueva demo de fábrica';
  form.elements.nombre.value = editando ? item.nombre || '' : '';
  form.elements.descripcion.value = editando ? item.descripcion || '' : '';
  $('wrapActivoDemo').hidden = !editando;
  form.elements.activo.checked = editando ? esActivo(item.activo) : true;
  bootstrap.Modal.getOrCreateInstance($('modalDemo')).show();
}

function abrirModalPaso(item = null) {
  if (!ESTADO.demoId || !ESTADO.comandos.length) {
    toast('Selecciona una demo y asegúrate de que la unidad tenga comandos.', 'warning');
    return;
  }
  const form = $('formPaso');
  const editando = Boolean(item);
  form.reset();
  form.elements.id.value = editando ? String(item.id_demo_movimiento) : '';
  $('modalPasoTitulo').textContent = editando ? 'Editar paso de demo' : 'Nuevo paso de demo';

  const select = form.elements.id_comando;
  select.textContent = '';
  select.appendChild(new Option('Selecciona un comando…', ''));
  ESTADO.comandos
    .filter((c) => esActivo(c.activo))
    .forEach((c) => {
      const tag = c.duracion_ms ? ` · ${c.duracion_ms}ms` : '';
      select.appendChild(
        new Option(`${c.nombre} (cód. ${c.codigo} / fís. ${c.codigo_fisico ?? c.codigo}${tag})`, String(c.id_comando))
      );
    });

  if (editando) {
    select.value = String(item.id_comando);
    form.elements.orden.value = String(item.orden);
    form.elements.duracion_ms.value = String(item.duracion_ms);
    form.elements.pausa_ms.value = String(item.pausa_ms);
  } else {
    const nextOrden = Math.max(0, ...ESTADO.pasos.map((p) => Number(p.orden) || 0)) + 1;
    form.elements.orden.value = String(nextOrden);
    form.elements.duracion_ms.value = '1000';
    form.elements.pausa_ms.value = '200';
  }
  bootstrap.Modal.getOrCreateInstance($('modalPaso')).show();
}

// ---------------------------------------------------------------------------
// GUARDADO DE FORMULARIOS
// ---------------------------------------------------------------------------
async function enviarFormulario(form, fn, modalId, msgOk, onSuccess) {
  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Guardando…';
  }
  let res;
  try {
    res = await fn();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText || 'Guardar';
    }
  }

  if (!res || !res.ok) {
    toast(formatApiError(res), 'danger');
    return;
  }
  UI.hideModal(modalId);
  toast(res.data?.mensaje || msgOk, 'success');
  await onSuccess();
}

function pedirConfirmacion(texto, accion, titulo = 'Confirmar acción') {
  $('modalConfirmarTitulo').textContent = titulo;
  $('confirmarTexto').textContent = texto;
  accionPendiente = accion;
  bootstrap.Modal.getOrCreateInstance($('modalConfirmar')).show();
}

// ---------------------------------------------------------------------------
// DELEGACIÓN DE ACCIONES
// ---------------------------------------------------------------------------
function manejarAccion(btn) {
  const { accion, tipo } = btn.dataset;
  const id = Number(btn.dataset.id);

  if (accion === 'nuevo') {
    if (tipo === 'modelo') return abrirModalModelo();
    if (tipo === 'capacidad') return abrirModalCapacidad();
    if (tipo === 'vehiculo') return abrirModalVehiculo();
    if (tipo === 'usuario') return abrirModalUsuario();
    if (tipo === 'comando') return abrirModalComando();
    if (tipo === 'demo') return abrirModalDemo();
    if (tipo === 'paso') return abrirModalPaso();
  }

  if (accion === 'editar') {
    if (tipo === 'modelo') return abrirModalModelo(ESTADO.modelos.find((m) => m.id_modelo === id));
    if (tipo === 'capacidad') return abrirModalCapacidad(ESTADO.capacidades.find((c) => c.id_capacidad === id));
    if (tipo === 'vehiculo') return abrirModalVehiculo(ESTADO.vehiculos.find((v) => v.id_vehiculo === id));
    if (tipo === 'usuario') return abrirModalUsuario(ESTADO.usuarios.find((u) => u.id_usuario === id));
    if (tipo === 'comando') return abrirModalComando(ESTADO.comandos.find((c) => c.id_comando === id));
    if (tipo === 'demo') return abrirModalDemo(ESTADO.demos.find((d) => d.id_demo === id));
    if (tipo === 'paso') return abrirModalPaso(ESTADO.pasos.find((p) => p.id_demo_movimiento === id));
  }

  if (accion === 'eliminar') {
    if (tipo === 'modelo') {
      const m = ESTADO.modelos.find((x) => x.id_modelo === id);
      return pedirConfirmacion(
        `¿Eliminar el modelo "${m?.nombre_comercial || `#${id}`}"? Si tiene unidades asociadas se aplicará baja lógica.`,
        async () => {
          const res = await adminApi.modelos.eliminar(id);
          if (!res.ok) return toast(formatApiError(res), 'danger');
          toast(res.data?.mensaje || 'Modelo procesado.', 'success');
          await Promise.all([cargarModelos(), cargarDashboard()]);
        }
      );
    }
    if (tipo === 'capacidad') {
      return pedirConfirmacion('¿Eliminar esta capacidad física del modelo?', async () => {
        const res = await adminApi.capacidades.eliminar(id);
        if (!res.ok) return toast(formatApiError(res), 'danger');
        toast('Capacidad eliminada.', 'success');
        await cargarCapacidades();
      });
    }
    if (tipo === 'vehiculo') {
      const v = ESTADO.vehiculos.find((x) => x.id_vehiculo === id);
      return pedirConfirmacion(
        `¿Dar de baja la unidad "${v?.nombre || `#${id}`}"? Si posee historial o asignaciones se aplicará BAJA LÓGICA obligatoria conservando los datos en RDS.`,
        async () => {
          const res = await adminApi.vehiculos.eliminar(id);
          if (!res.ok) return toast(formatApiError(res), 'danger');
          const modo = res.data?.modo_baja ? `[${res.data.modo_baja}] ` : '';
          toast(`${modo}${res.data?.mensaje || 'Unidad procesada.'}`, 'success');
          await Promise.all([cargarVehiculos(), cargarDashboard()]);
        }
      );
    }
    if (tipo === 'comando') {
      return pedirConfirmacion('¿Eliminar este comando de la unidad?', async () => {
        const res = await adminApi.comandos.eliminar(id);
        if (!res.ok) return toast(formatApiError(res), 'danger');
        toast('Comando eliminado.', 'success');
        await cargarComandos();
      });
    }
    if (tipo === 'demo') {
      return pedirConfirmacion('¿Eliminar esta demo de fábrica y todos sus pasos?', async () => {
        const res = await adminApi.demos.eliminar(id);
        if (!res.ok) return toast(formatApiError(res), 'danger');
        toast('Demo eliminada.', 'success');
        await cargarDemos();
        await cargarPasos();
      });
    }
    if (tipo === 'paso') {
      return pedirConfirmacion('¿Eliminar este paso de la secuencia?', async () => {
        const res = await adminApi.pasos.eliminar(id);
        if (!res.ok) return toast(formatApiError(res), 'danger');
        toast('Paso eliminado.', 'success');
        await cargarPasos();
      });
    }
  }

  if (accion === 'desactivar-usuario') {
    const u = ESTADO.usuarios.find((x) => x.id_usuario === id);
    return pedirConfirmacion(
      `¿Desactivar a "${u?.nombre || `#${id}`}"? Sus tokens activos quedarán invalidados inmediatamente.`,
      async () => {
        const res = await adminApi.usuarios.desactivar(id);
        if (!res.ok) return toast(formatApiError(res), 'danger');
        toast(res.data?.mensaje || 'Usuario desactivado.', 'success');
        await Promise.all([cargarUsuarios(), cargarDashboard()]);
      },
      'Desactivar usuario'
    );
  }

  if (accion === 'cancelar-sesion-invitado') {
    return pedirConfirmacion(
      `¿Cancelar la sesión de invitado #${id}? Se emitirá DETENER (12) al vehículo y se liberará la unidad.`,
      async () => {
        const res = await adminApi.invitados.cancelarAdmin(id);
        if (!res.ok) return toast(formatApiError(res), 'danger');
        toast('Sesión de invitado cancelada y vehículo detenido.', 'success');
        await cargarDashboard();
      },
      'Cancelar sesión de invitado'
    );
  }

  if (accion === 'ver-capacidades') {
    ESTADO.modeloId = id;
    const sel = $('adminModeloCapSelect');
    if (sel) sel.value = String(id);
    cargarCapacidades();
    $('adminCapacidadesCard')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  if (accion === 'asignar-propietario') {
    const v = ESTADO.vehiculos.find((x) => x.id_vehiculo === id);
    if (v) abrirModalAsignar(v);
  }

  if (accion === 'ver-historial-propietarios') {
    const v = ESTADO.vehiculos.find((x) => x.id_vehiculo === id);
    if (v) abrirHistorialPropietarios(v);
  }

  if (accion === 'operar-vehiculo') {
    const v = ESTADO.vehiculos.find((x) => x.id_vehiculo === id);
    if (v && onOperarVehiculoCallback) {
      onOperarVehiculoCallback(v);
    }
  }

  if (accion === 'ver-pasos') {
    ESTADO.demoId = id;
    poblarSelectDemos();
    cargarPasos();
    bootstrap.Tab.getOrCreateInstance($('adminTabPasos')).show();
  }

  if (accion === 'subir-paso') moverPaso(id, -1);
  if (accion === 'bajar-paso') moverPaso(id, 1);
}

// ---------------------------------------------------------------------------
// ENTRADA E INICIALIZACIÓN DEL MÓDULO
// ---------------------------------------------------------------------------
export async function alEntrarAdmin() {
  await Promise.allSettled([
    cargarDashboard(),
    cargarModelos(),
    cargarUsuarios(),
    cargarVehiculos(),
    cargarAuditoria(true),
  ]);
}

export function initAdmin({ onOperarVehiculo } = {}) {
  onOperarVehiculoCallback = onOperarVehiculo || null;

  $('adminView')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-accion]');
    if (!btn) return;
    const ddToggle = btn.closest('.dropdown')?.querySelector('[data-bs-toggle="dropdown"]');
    if (ddToggle && window.bootstrap?.Dropdown) {
      window.bootstrap.Dropdown.getInstance(ddToggle)?.hide();
    }
    manejarAccion(btn);
  });

  $('btnRefreshDashboard')?.addEventListener('click', () => cargarDashboard());

  $('adminModeloCapSelect')?.addEventListener('change', (e) => {
    ESTADO.modeloId = Number(e.target.value) || null;
    cargarCapacidades();
  });

  $('adminFiltroEstadoVehiculo')?.addEventListener('change', (e) => {
    ESTADO.filtroEstadoVehiculo = e.target.value || '';
    cargarVehiculos();
  });

  $('adminVehiculoSelect')?.addEventListener('change', (e) => {
    ESTADO.vehiculoId = Number(e.target.value) || null;
    cargarDatosVehiculo();
  });

  $('adminDemoSelect')?.addEventListener('change', (e) => {
    ESTADO.demoId = Number(e.target.value) || null;
    cargarPasos();
  });

  $('formComando')?.elements?.es_temporizado?.addEventListener('change', sincronizarTipoComandoForm);

  // Filtros y paginación de auditoría
  $('formFiltrosAuditoria')?.addEventListener('submit', (e) => {
    e.preventDefault();
    cargarAuditoria(true);
  });
  $('btnAudLimpiar')?.addEventListener('click', () => {
    $('formFiltrosAuditoria')?.reset();
    cargarAuditoria(true);
  });
  $('btnAudPrev')?.addEventListener('click', () => {
    ESTADO.auditoria.offset = Math.max(0, ESTADO.auditoria.offset - ESTADO.auditoria.limit);
    cargarAuditoria(false);
  });
  $('btnAudNext')?.addEventListener('click', () => {
    ESTADO.auditoria.offset += ESTADO.auditoria.limit;
    cargarAuditoria(false);
  });

  // Submit: Modelo
  $('formModelo')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const editando = form.elements.id.value !== '';
    const datos = {
      codigo_modelo: leerTexto(form, 'codigo_modelo'),
      nombre_comercial: leerTexto(form, 'nombre_comercial'),
      descripcion: leerTexto(form, 'descripcion') || null,
      url_imagen: leerTexto(form, 'url_imagen') || null,
      activo: form.elements.activo.checked,
    };
    if (!datos.codigo_modelo || !datos.nombre_comercial) {
      return toast('Código de modelo y nombre comercial son obligatorios.', 'warning');
    }
    const id = Number(form.elements.id.value);
    enviarFormulario(
      form,
      () => (editando ? adminApi.modelos.actualizar(id, datos) : adminApi.modelos.crear(datos)),
      'modalModelo',
      'Modelo guardado.',
      () => Promise.all([cargarModelos(), cargarDashboard()])
    );
  });

  // Submit: Capacidad de Modelo
  $('formCapacidad')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const editando = form.elements.id.value !== '';
    const datos = {
      codigo_fisico: leerEntero(form, 'codigo_fisico'),
      nombre_base: leerTexto(form, 'nombre_base'),
      descripcion: leerTexto(form, 'descripcion') || null,
      permite_temporizado: form.elements.permite_temporizado.checked,
      permitido_invitado_default: form.elements.permitido_invitado_default.checked,
      activo: form.elements.activo.checked,
    };
    if (!Number.isInteger(datos.codigo_fisico) || datos.codigo_fisico < 1 || !datos.nombre_base) {
      return toast('Código físico (>= 1) y nombre base son obligatorios.', 'warning');
    }
    const id = Number(form.elements.id.value);
    enviarFormulario(
      form,
      () =>
        editando
          ? adminApi.capacidades.actualizar(id, datos)
          : adminApi.capacidades.crear(ESTADO.modeloId, datos),
      'modalCapacidad',
      'Capacidad guardada.',
      cargarCapacidades
    );
  });

  // Submit: Vehículo
  $('formVehiculo')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const editando = form.elements.id.value !== '';
    const idModeloRaw = leerTexto(form, 'id_modelo');
    const datos = {
      nombre: leerTexto(form, 'nombre'),
      id_modelo: idModeloRaw ? Number(idModeloRaw) : null,
      modelo: leerTexto(form, 'modelo') || null,
      numero_serie: leerTexto(form, 'numero_serie') || null,
      microcontrolador: leerTexto(form, 'microcontrolador') || null,
      estado_comercial: leerTexto(form, 'estado_comercial') || 'DISPONIBLE',
      descripcion: leerTexto(form, 'descripcion') || null,
    };
    if (!datos.nombre) return toast('El nombre de la unidad es obligatorio.', 'warning');
    if (editando) datos.activo = form.elements.activo.checked;
    const id = Number(form.elements.id.value);
    enviarFormulario(
      form,
      () => (editando ? adminApi.vehiculos.actualizar(id, datos) : adminApi.vehiculos.crear(datos)),
      'modalVehiculo',
      'Unidad guardada.',
      () => Promise.all([cargarVehiculos(), cargarDashboard()])
    );
  });

  // Submit: Asignar / Reasignar Propietario
  $('formAsignarPropietario')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const idVeh = Number(form.elements.id_vehiculo.value);
    const propRaw = leerTexto(form, 'id_nuevo_propietario');
    const datos = {
      id_nuevo_propietario: propRaw ? Number(propRaw) : null,
      nuevo_estado_comercial: leerTexto(form, 'nuevo_estado_comercial') || null,
      motivo: leerTexto(form, 'motivo') || 'Asignación administrativa',
    };
    enviarFormulario(
      form,
      () => adminApi.vehiculos.asignar(idVeh, datos),
      'modalAsignarPropietario',
      'Propietario asignado correctamente.',
      () => Promise.all([cargarVehiculos(), cargarDashboard(), cargarAuditoria(true)])
    );
  });

  // Submit: Usuario
  $('formUsuario')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const editando = form.elements.id.value !== '';
    const password = String(form.elements.password.value || '');
    const datos = {
      nombre: leerTexto(form, 'nombre'),
      correo: leerTexto(form, 'correo'),
      rol: leerTexto(form, 'rol'),
      activo: form.elements.activo.checked,
    };
    if (!datos.nombre || !datos.correo) {
      return toast('Nombre y correo son obligatorios.', 'warning');
    }
    if (!editando && password.length < 8) {
      return toast('La contraseña inicial debe tener al menos 8 caracteres.', 'warning');
    }
    if (password) {
      if (password.length < 8) {
        return toast('La nueva contraseña debe tener al menos 8 caracteres.', 'warning');
      }
      datos.password = password;
    }
    const id = Number(form.elements.id.value);
    enviarFormulario(
      form,
      () => (editando ? adminApi.usuarios.actualizar(id, datos) : adminApi.usuarios.crear(datos)),
      'modalUsuario',
      'Usuario guardado.',
      () => Promise.all([cargarUsuarios(), cargarDashboard()])
    );
  });

  // Submit: Comando v2
  $('formComando')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const editando = form.elements.id.value !== '';
    const esTemp = form.elements.es_temporizado.checked;
    const codigo = leerEntero(form, 'codigo');
    const codigoFisico = leerEntero(form, 'codigo_fisico');
    const duracionMs = esTemp ? leerEntero(form, 'duracion_ms') : null;

    if (!leerTexto(form, 'nombre')) return toast('El nombre del comando es obligatorio.', 'warning');
    if (!Number.isInteger(codigo) || codigo < 1) {
      return toast('El código lógico debe ser un entero >= 1.', 'warning');
    }
    if (!Number.isInteger(codigoFisico) || codigoFisico < 1) {
      return toast('El código físico debe ser un entero >= 1.', 'warning');
    }
    if (esTemp && (!Number.isInteger(duracionMs) || duracionMs < 1 || duracionMs > 10000)) {
      return toast('La duración temporizada debe estar entre 1 y 10000 ms.', 'warning');
    }

    const datos = {
      nombre: leerTexto(form, 'nombre'),
      codigo,
      codigo_fisico: codigoFisico,
      duracion_ms: duracionMs,
      descripcion: leerTexto(form, 'descripcion') || null,
      permitido_invitado: form.elements.permitido_invitado.checked,
    };
    if (editando) datos.activo = form.elements.activo.checked;

    const id = Number(form.elements.id.value);
    enviarFormulario(
      form,
      () =>
        editando
          ? adminApi.comandos.actualizar(id, datos)
          : adminApi.comandos.crear(ESTADO.vehiculoId, datos),
      'modalComando',
      'Comando guardado.',
      cargarComandos
    );
  });

  // Submit: Demo Fábrica
  $('formDemo')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const editando = form.elements.id.value !== '';
    const datos = {
      nombre: leerTexto(form, 'nombre'),
      descripcion: leerTexto(form, 'descripcion') || null,
    };
    if (!datos.nombre) return toast('El nombre de la demo es obligatorio.', 'warning');
    if (editando) datos.activo = form.elements.activo.checked;
    else datos.tipo = 'FABRICA';

    const id = Number(form.elements.id.value);
    enviarFormulario(
      form,
      () =>
        editando
          ? adminApi.demos.actualizar(id, datos)
          : adminApi.demos.crear(ESTADO.vehiculoId, datos),
      'modalDemo',
      'Demo guardada.',
      async () => {
        await cargarDemos();
        await cargarPasos();
      }
    );
  });

  // Submit: Paso de Demo
  $('formPaso')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const editando = form.elements.id.value !== '';
    const datos = {
      id_comando: leerEntero(form, 'id_comando'),
      orden: leerEntero(form, 'orden'),
      duracion_ms: leerEntero(form, 'duracion_ms'),
      pausa_ms: leerEntero(form, 'pausa_ms'),
    };
    if (!Number.isInteger(datos.id_comando)) return toast('Selecciona un comando.', 'warning');
    if (!Number.isInteger(datos.orden) || datos.orden < 1) return toast('Orden >= 1.', 'warning');
    if (!Number.isInteger(datos.duracion_ms) || datos.duracion_ms < 1 || datos.duracion_ms > 10000) {
      return toast('Duración debe estar entre 1 y 10000 ms.', 'warning');
    }
    if (!Number.isInteger(datos.pausa_ms) || datos.pausa_ms < 0 || datos.pausa_ms > 10000) {
      return toast('Pausa debe estar entre 0 y 10000 ms.', 'warning');
    }

    const id = Number(form.elements.id.value);
    enviarFormulario(
      form,
      () => (editando ? adminApi.pasos.actualizar(id, datos) : adminApi.pasos.crear(ESTADO.demoId, datos)),
      'modalPaso',
      'Paso guardado.',
      cargarPasos
    );
  });

  // Al seleccionar propietario en el modal de asignación, ajustar estado comercial sugerido
  $('asignarPropietarioSelect')?.addEventListener('change', (e) => {
    const estSel = $('asignarEstadoComercial');
    if (!estSel) return;
    estSel.value = e.target.value ? 'VENDIDO' : 'DISPONIBLE';
  });

  // Limpiar acción pendiente al cerrar/cancelar modal de confirmación
  $('modalConfirmar')?.addEventListener('hidden.bs.modal', () => {
    accionPendiente = null;
  });

  // Confirmación genérica: cerrar la ventana de inmediato al confirmar y ejecutar la acción
  $('btnConfirmarAccion')?.addEventListener('click', async () => {
    const accion = accionPendiente;
    if (!accion) return;
    accionPendiente = null;
    UI.hideModal('modalConfirmar');
    try {
      await accion();
    } catch (err) {
      toast(`Error al procesar la acción: ${err?.message || 'desconocido'}`, 'danger');
    }
  });
}
