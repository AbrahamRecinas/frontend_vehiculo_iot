/**
 * user_vehicles.js
 * Módulo completo de Tienda / Comprador (rol USUARIO) dentro de «Mis Vehículos»:
 *  - Lista y selección de unidades propias + alternancia Modo Exhibición (VENDIDO <-> EXHIBICION)
 *  - Comandos físicos base (solo lectura/ejecución) + CRUD Movimientos Temporizados propios
 *  - Editor Visual Táctil de Demos Privadas (pasos, duración/pausa, reordenar +10000, duración total)
 *  - Gestión de Autorizaciones Temporales de Soporte al ADMIN
 * Todo dato proveniente de la API se inserta con textContent y DOM API seguro.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';
import { api, formatApiError } from './api.js';
import { UI } from './ui.js?v=4.3.4';

const $ = (id) => document.getElementById(id);
const esActivo = (v) => v === 1 || v === true || v === '1';
const toast = (msg, tipo = 'info') => UI.showToast(msg, tipo);

const STORE = {
  vehiculos: [],
  vehiculoActivo: null,
  capacidades: [],
  comandos: [],
  demos: [],
  demoSeleccionada: null,
  pasos: [],
  soportes: [],
};

let callbacks = {
  onSelectForControl: null,
  onSelectForMonitor: null,
  onUnitDataChanged: null,
  onEstadoComercialChanged: null,
  onExecuteCommand: null,
  onExecuteDemo: null,
  onCancelDemo: null,
};

let confirmActionPending = null;
let vistaListaActiva = false;

function crearIndicadorHardware(conectado) {
  const hwOnline = conectado === true || conectado === 1;
  const span = document.createElement('span');
  span.className = `hw-indicator ${hwOnline ? 'hw-indicator--online' : 'hw-indicator--offline'}`;
  const dot = document.createElement('span');
  dot.className = 'hw-dot';
  dot.setAttribute('aria-hidden', 'true');
  span.append(dot, document.createTextNode(hwOnline ? 'ESP8266 · En línea' : 'ESP8266 · Sin señal'));
  return span;
}

function mostrarAlertaTienda(mensaje = '') {
  const box = $('userVehiclesAlert');
  if (!box) return;
  if (!mensaje) {
    box.textContent = '';
    box.hidden = true;
    return;
  }
  box.textContent = mensaje;
  box.hidden = false;
}

function crearBoton({ icono, texto = '', clase = 'btn-outline-secondary', title = '', disabled = false, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn btn-sm ${clase}`;
  btn.disabled = Boolean(disabled);
  if (title) btn.title = title;
  if (icono) {
    const i = document.createElement('i');
    i.className = `bi ${icono}${texto ? ' me-1' : ''}`;
    i.setAttribute('aria-hidden', 'true');
    btn.appendChild(i);
  }
  if (texto) btn.appendChild(document.createTextNode(texto));
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

function crearBadge(texto, clase) {
  const span = document.createElement('span');
  span.className = `badge ${clase}`;
  span.textContent = texto;
  return span;
}

function pintarEstadoVacio(container, mensaje, { tono = 'secondary', onRetry = null } = {}) {
  if (!container) return;
  container.textContent = '';
  const box = document.createElement('div');
  box.className = `p-3 rounded border border-secondary-subtle text-center small text-${tono} bg-dark`;
  const p = document.createElement('p');
  p.className = onRetry ? 'mb-2' : 'mb-0';
  p.textContent = mensaje;
  box.appendChild(p);
  if (onRetry) {
    box.appendChild(
      crearBoton({
        icono: 'bi-arrow-clockwise',
        texto: 'Reintentar',
        clase: 'btn-outline-info',
        onClick: onRetry,
      })
    );
  }
  container.appendChild(box);
}

function pintarTablaMensaje(tbodyId, texto, { tono = 'secondary', onRetry = null } = {}) {
  const tbody = $(tbodyId);
  if (!tbody) return;
  tbody.textContent = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = tbody.closest('table')?.tHead?.rows[0]?.cells.length || 5;
  td.className = `text-center small py-3 text-${tono}`;
  const span = document.createElement('span');
  span.textContent = texto;
  td.appendChild(span);
  if (onRetry) {
    const wrap = document.createElement('div');
    wrap.className = 'mt-2';
    wrap.appendChild(
      crearBoton({
        icono: 'bi-arrow-clockwise',
        texto: 'Reintentar',
        clase: 'btn-outline-info',
        onClick: onRetry,
      })
    );
    td.appendChild(wrap);
  }
  tr.appendChild(td);
  tbody.appendChild(tr);
  UI.etiquetarCeldas(tbody);
}

function pedirConfirmacion(titulo, texto, fn) {
  const titleEl = $('modalConfirmarTitulo');
  const bodyEl = $('confirmarTexto');
  if (titleEl) titleEl.textContent = titulo;
  if (bodyEl) bodyEl.textContent = texto;
  confirmActionPending = fn;
  bootstrap.Modal.getOrCreateInstance($('modalConfirmar')).show();
}

function formatearFechaHora(raw) {
  if (!raw) return '—';
  return String(raw).replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------------------
// 1. CARGA Y RENDER DE UNIDADES PROPIAS + MODO EXHIBICIÓN EN MOSTRADOR
// ---------------------------------------------------------------------------
export async function cargarMisVehiculosModulo(preferVehicleId = null) {
  const grid = $('userVehiclesGrid');
  const workspace = $('userUnitWorkspace');
  if (grid) {
    grid.hidden = false;
    pintarEstadoVacio(grid, 'Cargando tus vehículos asignados…');
  }

  const res = await api.obtenerVehiculos();
  if (!res.ok) {
    STORE.vehiculos = [];
    STORE.vehiculoActivo = null;
    if (workspace) workspace.hidden = true;
    if (grid) {
      grid.hidden = false;
      pintarEstadoVacio(grid, `Error al cargar tus vehículos: ${formatApiError(res)}`, {
        tono: 'danger',
        onRetry: () => cargarMisVehiculosModulo(preferVehicleId),
      });
    }
    return [];
  }

  STORE.vehiculos = Array.isArray(res.data) ? res.data : [];
  if (!STORE.vehiculos.length) {
    STORE.vehiculoActivo = null;
    if (workspace) workspace.hidden = true;
    if (grid) {
      grid.hidden = false;
      pintarEstadoVacio(
        grid,
        'Aún no tienes vehículos asignados a tu cuenta. Solicita a la fábrica la asignación de tus unidades.'
      );
    }
    return [];
  }

  const targetId = preferVehicleId ?? STORE.vehiculoActivo?.id_vehiculo ?? STORE.vehiculos[0].id_vehiculo;
  STORE.vehiculoActivo =
    STORE.vehiculos.find((v) => v.id_vehiculo === Number(targetId)) || STORE.vehiculos[0];

  // Vista enfocada sin tarjetas duplicadas: con 1 unidad entra directo al workspace unificado;
  // con > 1 unidad solo muestra la lista cuando el usuario pulsa "← Unidades".
  if (STORE.vehiculos.length === 1) {
    vistaListaActiva = false;
  }
  const btnBack = $('btnUserBackToList');
  if (btnBack) btnBack.hidden = STORE.vehiculos.length <= 1;

  if (vistaListaActiva && STORE.vehiculos.length > 1) {
    if (grid) grid.hidden = false;
    if (workspace) workspace.hidden = true;
    renderTarjetasVehiculos();
  } else {
    if (grid) {
      grid.hidden = true;
      grid.textContent = '';
    }
    await cargarWorkspaceUnidad(STORE.vehiculoActivo);
  }
  return STORE.vehiculos;
}

function renderTarjetasVehiculos() {
  const grid = $('userVehiclesGrid');
  if (!grid) return;
  grid.textContent = '';

  STORE.vehiculos.forEach((v) => {
    const seleccionado = STORE.vehiculoActivo?.id_vehiculo === v.id_vehiculo;
    const enExhibicion = v.estado_comercial === 'EXHIBICION';

    const col = document.createElement('div');
    col.className = 'col-12 col-lg-6';

    const card = document.createElement('div');
    card.className = `card bg-dark h-100 ${seleccionado ? 'border-info shadow' : 'border-secondary-subtle'}`;

    const body = document.createElement('div');
    body.className = 'card-body p-3 d-flex flex-column gap-2';

    const top = document.createElement('div');
    top.className = 'd-flex flex-wrap justify-content-between align-items-center gap-2';

    const titleWrap = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.className = 'h6 text-white fw-bold mb-0';
    h3.textContent = `${v.nombre} (#${v.id_vehiculo})`;
    const sub = document.createElement('small');
    sub.className = 'text-secondary';
    sub.textContent = `${v.nombre_comercial || v.modelo || 'Grúa RC IoT'}${v.numero_serie ? ` · Serie: ${v.numero_serie}` : ''}`;
    titleWrap.append(h3, sub);

    const badges = document.createElement('div');
    badges.className = 'd-flex flex-wrap gap-1';
    badges.appendChild(
      crearBadge(
        enExhibicion ? 'EXHIBICIÓN MOSTRADOR' : v.estado_comercial || 'VENDIDO',
        enExhibicion
          ? 'bg-primary-subtle text-primary border border-primary-subtle'
          : 'bg-warning-subtle text-warning border border-warning-subtle'
      )
    );
    badges.appendChild(crearIndicadorHardware(v.dispositivo_conectado));
    if (v.soporte_activo) {
      badges.appendChild(
        crearBadge('Soporte activo', 'bg-success-subtle text-success border border-success-subtle')
      );
    }
    if (v.sesion_invitado_activa) {
      badges.appendChild(
        crearBadge('Invitado probando', 'bg-info-subtle text-info border border-info-subtle')
      );
    }

    top.append(titleWrap, badges);

    const actions = document.createElement('div');
    actions.className = 'd-flex flex-wrap gap-2 mt-auto pt-2 border-top border-secondary-subtle';

    actions.append(
      crearBoton({
        icono: 'bi-controller',
        texto: 'Controlar',
        clase: 'btn-primary flex-fill',
        onClick: () => callbacks.onSelectForControl?.(v),
      }),
      crearBoton({
        icono: 'bi-activity',
        texto: 'Monitoreo',
        clase: 'btn-outline-info flex-fill',
        onClick: () => callbacks.onSelectForMonitor?.(v),
      }),
      crearBoton({
        icono: 'bi-sliders',
        texto: 'Gestionar',
        clase: 'btn-outline-light flex-fill',
        onClick: async () => {
          STORE.vehiculoActivo = v;
          vistaListaActiva = false;
          if ($('userVehiclesGrid')) {
            $('userVehiclesGrid').hidden = true;
            $('userVehiclesGrid').textContent = '';
          }
          await cargarWorkspaceUnidad(v);
        },
      }),
      crearBoton({
        icono: enExhibicion ? 'bi-shop-window' : 'bi-shop',
        texto: enExhibicion ? 'Cambiar a VENDIDO (tienda)' : 'Cambiar a EXHIBICIÓN (mostrador)',
        clase: enExhibicion ? 'btn-outline-warning w-100' : 'btn-outline-success w-100',
        onClick: () => solicitarCambioExhibicion(v, !enExhibicion),
      })
    );

    body.append(top, actions);
    card.appendChild(body);
    col.appendChild(card);
    grid.appendChild(col);
  });
}

function solicitarCambioExhibicion(vehiculo, habilitar) {
  mostrarAlertaTienda('');
  const titulo = habilitar ? 'Habilitar Modo Exhibición' : 'Desactivar Modo Exhibición';
  const msg = habilitar
    ? `¿Habilitar "${vehiculo.nombre}" (#${vehiculo.id_vehiculo}) en modo EXHIBICIÓN para que clientes invitados puedan reservarlo y probarlo desde el catálogo público? (El ADMIN seguirá sin acceso operativo salvo que le otorgues soporte).`
    : `¿Pasar "${vehiculo.nombre}" (#${vehiculo.id_vehiculo}) a estado VENDIDO (uso exclusivo de tienda)?${
        vehiculo.sesion_invitado_activa
          ? ' Hay una sesión de invitado activa: se enviará DETENER (12) y se cerrará su sesión inmediatamente.'
          : ''
      }`;

  pedirConfirmacion(titulo, msg, async () => {
    const res = await api.cambiarModoExhibicion(
      vehiculo.id_vehiculo,
      habilitar,
      habilitar ? 'Habilitado desde panel de Tienda' : 'Desactivado desde panel de Tienda'
    );
    if (!res.ok) {
      const errMsg = `Error HTTP ${res.status || 'red'}: ${formatApiError(res, 'No se pudo cambiar el estado comercial.')}`;
      mostrarAlertaTienda(errMsg);
      toast(errMsg, 'danger');
      return;
    }
    mostrarAlertaTienda('');
    toast(res.data?.mensaje || 'Estado comercial actualizado correctamente.', 'success');
    const actualizada = res.data?.vehiculo || {
      ...vehiculo,
      estado_comercial: res.data?.estado_comercial || (habilitar ? 'EXHIBICION' : 'VENDIDO'),
    };
    await cargarMisVehiculosModulo(vehiculo.id_vehiculo);
    callbacks.onEstadoComercialChanged?.(actualizada);
    callbacks.onUnitDataChanged?.(vehiculo.id_vehiculo);
  });
}

// ---------------------------------------------------------------------------
// 2. WORKSPACE DE LA UNIDAD SELECCIONADA (Comandos, Demos Privadas, Soporte)
// ---------------------------------------------------------------------------
async function cargarWorkspaceUnidad(vehiculo) {
  const workspace = $('userUnitWorkspace');
  if (!workspace || !vehiculo) return;
  workspace.hidden = false;

  const titulo = $('userWorkspaceTitle');
  const estadoBadge = $('userWorkspaceEstado');
  const btnToggle = $('btnUserWorkspaceToggleExhibicion');
  const enExhibicion = vehiculo.estado_comercial === 'EXHIBICION';

  if (titulo) titulo.textContent = `${vehiculo.nombre} (#${vehiculo.id_vehiculo})`;
  UI.setHardwareStatus(
    vehiculo.dispositivo_conectado === undefined ? null : Boolean(vehiculo.dispositivo_conectado)
  );
  if (estadoBadge) {
    estadoBadge.textContent = vehiculo.estado_comercial || 'VENDIDO';
    estadoBadge.className = enExhibicion
      ? 'badge bg-primary-subtle text-primary border border-primary-subtle'
      : 'badge bg-warning-subtle text-warning border border-warning-subtle';
  }
  if (btnToggle) {
    btnToggle.className = enExhibicion
      ? 'btn btn-sm btn-outline-warning'
      : 'btn btn-sm btn-outline-success';
    btnToggle.textContent = '';
    const ico = document.createElement('i');
    ico.className = `bi ${enExhibicion ? 'bi-shop-window' : 'bi-shop'} me-1`;
    ico.setAttribute('aria-hidden', 'true');
    btnToggle.append(
      ico,
      document.createTextNode(enExhibicion ? 'Cambiar a VENDIDO' : 'Cambiar a EXHIBICIÓN')
    );
  }

  STORE.demoSeleccionada = null;

  await Promise.all([
    cargarCapacidadesUnidad(vehiculo),
    cargarComandosUnidad(vehiculo.id_vehiculo),
    cargarDemosUnidad(vehiculo.id_vehiculo),
    cargarSoporteUnidad(vehiculo),
  ]);
}

async function cargarCapacidadesUnidad(vehiculo) {
  if (!vehiculo?.id_modelo) {
    STORE.capacidades = [];
    return;
  }
  const res = await api.obtenerCapacidadesModelo(vehiculo.id_modelo);
  STORE.capacidades = res.ok && Array.isArray(res.data) ? res.data : [];
}

// ---------------------------------------------------------------------------
// TAB 1: COMANDOS BASE (SOLO LECTURA) + MOVIMIENTOS TEMPORIZADOS PROPIOS (CRUD)
// ---------------------------------------------------------------------------
async function cargarComandosUnidad(idVehiculo) {
  pintarTablaMensaje('userBaseCommandsBody', 'Cargando comandos físicos base…');
  pintarTablaMensaje('userTimedCommandsBody', 'Cargando tus movimientos temporizados…');

  const res = await api.obtenerComandos(idVehiculo);
  if (!res.ok) {
    STORE.comandos = [];
    const err = formatApiError(res, 'Error al cargar comandos.');
    pintarTablaMensaje('userBaseCommandsBody', err, {
      tono: 'danger',
      onRetry: () => cargarComandosUnidad(idVehiculo),
    });
    pintarTablaMensaje('userTimedCommandsBody', err, {
      tono: 'danger',
      onRetry: () => cargarComandosUnidad(idVehiculo),
    });
    return;
  }

  STORE.comandos = Array.isArray(res.data)
    ? res.data.sort((a, b) => Number(a.codigo) - Number(b.codigo))
    : [];
  renderTablasComandos();
}

function renderTablasComandos() {
  const baseBody = $('userBaseCommandsBody');
  const timedBody = $('userTimedCommandsBody');

  const baseCmds = STORE.comandos.filter(
    (c) => c.duracion_ms === null || c.duracion_ms === undefined
  );
  const timedCmds = STORE.comandos.filter(
    (c) => c.duracion_ms !== null && c.duracion_ms !== undefined && Number(c.duracion_ms) > 0
  );

  // Comandos base (protegidos: solo lectura y ejecución)
  if (baseBody) {
    baseBody.textContent = '';
    if (!baseCmds.length) {
      pintarTablaMensaje('userBaseCommandsBody', 'Sin comandos base registrados en esta unidad.');
    } else {
      baseCmds.forEach((c) => {
        const tr = document.createElement('tr');
        const tdCod = document.createElement('td');
        tdCod.className = 'text-center font-monospace';
        tdCod.textContent = String(c.codigo_fisico ?? c.codigo);

        const tdNom = document.createElement('td');
        const meta = CONFIG.COMMAND_META[Number(c.codigo_fisico ?? c.codigo)];
        if (meta?.icon) {
          const ico = document.createElement('i');
          ico.className = `bi ${meta.icon} me-1 text-info`;
          ico.setAttribute('aria-hidden', 'true');
          tdNom.appendChild(ico);
        }
        tdNom.appendChild(document.createTextNode(c.nombre));

        const tdTipo = document.createElement('td');
        tdTipo.className = 'text-center';
        tdTipo.appendChild(
          crearBadge('Base · protegido', 'bg-secondary-subtle text-light border border-secondary')
        );

        const tdInv = document.createElement('td');
        tdInv.className = 'text-center';
        tdInv.appendChild(
          crearBadge(
            esActivo(c.permitido_invitado) ? 'Sí' : 'No',
            esActivo(c.permitido_invitado)
              ? 'bg-primary-subtle text-primary border border-primary-subtle'
              : 'bg-secondary-subtle text-secondary border border-secondary-subtle'
          )
        );

        const tdAcc = document.createElement('td');
        tdAcc.className = 'text-end';
        tdAcc.appendChild(
          crearBoton({
            icono: 'bi-play-fill',
            texto: 'Ejecutar',
            clase: 'btn-outline-success',
            disabled: !esActivo(c.activo),
            onClick: () => callbacks.onExecuteCommand?.(STORE.vehiculoActivo, c),
          })
        );

        tr.append(tdCod, tdNom, tdTipo, tdInv, tdAcc);
        baseBody.appendChild(tr);
      });
      UI.etiquetarCeldas(baseBody);
    }
  }

  // Movimientos personalizados temporizados (CRUD completo)
  if (timedBody) {
    timedBody.textContent = '';
    if (!timedCmds.length) {
      pintarTablaMensaje(
        'userTimedCommandsBody',
        'Aún no has creado movimientos temporizados personalizados para esta unidad.'
      );
    } else {
      timedCmds.forEach((c) => {
        const tr = document.createElement('tr');

        const tdNom = document.createElement('td');
        const meta = CONFIG.COMMAND_META[Number(c.codigo_fisico)];
        if (meta?.icon) {
          const ico = document.createElement('i');
          ico.className = `bi ${meta.icon} me-1 text-info`;
          ico.setAttribute('aria-hidden', 'true');
          tdNom.appendChild(ico);
        }
        tdNom.appendChild(document.createTextNode(c.nombre));

        const tdFis = document.createElement('td');
        tdFis.className = 'text-center font-monospace';
        const cap = STORE.capacidades.find((x) => Number(x.codigo_fisico) === Number(c.codigo_fisico));
        tdFis.textContent = cap ? `${cap.nombre_base} (#${c.codigo_fisico})` : `#${c.codigo_fisico}`;

        const tdDur = document.createElement('td');
        tdDur.className = 'text-center font-monospace';
        tdDur.appendChild(
          crearBadge(`${c.duracion_ms} ms`, 'bg-info-subtle text-info border border-info-subtle')
        );

        const tdInv = document.createElement('td');
        tdInv.className = 'text-center';
        tdInv.appendChild(
          crearBadge(
            esActivo(c.permitido_invitado) ? 'Sí' : 'No',
            esActivo(c.permitido_invitado)
              ? 'bg-primary-subtle text-primary border border-primary-subtle'
              : 'bg-secondary-subtle text-secondary border border-secondary-subtle'
          )
        );

        const tdAcc = document.createElement('td');
        tdAcc.className = 'text-end text-nowrap';
        tdAcc.append(
          crearBoton({
            icono: 'bi-play-fill',
            texto: 'Probar',
            clase: 'btn-outline-success me-1',
            disabled: !esActivo(c.activo),
            onClick: () => callbacks.onExecuteCommand?.(STORE.vehiculoActivo, c),
          }),
          crearBoton({
            icono: 'bi-pencil-square',
            texto: 'Editar',
            clase: 'btn-outline-info me-1',
            onClick: () => abrirModalTemporizado(c),
          }),
          crearBoton({
            icono: 'bi-trash',
            texto: 'Eliminar',
            clase: 'btn-outline-danger',
            onClick: () => eliminarTemporizado(c),
          })
        );

        tr.append(tdNom, tdFis, tdDur, tdInv, tdAcc);
        timedBody.appendChild(tr);
      });
      UI.etiquetarCeldas(timedBody);
    }
  }
}

function abrirModalTemporizado(item = null) {
  if (!STORE.vehiculoActivo) return;
  const form = $('formUserTimedCmd');
  const editando = Boolean(item);
  form.reset();
  form.elements.id.value = editando ? String(item.id_comando) : '';
  $('modalUserTimedCmdTitulo').textContent = editando
    ? 'Editar movimiento temporizado'
    : 'Nuevo movimiento temporizado';

  // Filtrar capacidades físicas con permite_temporizado = 1
  const select = form.elements.codigo_fisico;
  select.textContent = '';
  const capsTemp = STORE.capacidades.filter(
    (c) => esActivo(c.activo) && esActivo(c.permite_temporizado)
  );
  if (capsTemp.length) {
    capsTemp.forEach((c) => {
      select.appendChild(
        new Option(`${c.nombre_base} (código físico ${c.codigo_fisico})`, String(c.codigo_fisico))
      );
    });
  } else {
    // Fallback informativo si la unidad no tiene modelo asociado
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((cf) => {
      const m = CONFIG.COMMAND_META[cf];
      select.appendChild(new Option(`${m?.label || `Acción ${cf}`} (físico ${cf})`, String(cf)));
    });
  }

  form.elements.nombre.value = editando ? item.nombre || '' : '';
  if (editando) select.value = String(item.codigo_fisico);
  const dur = editando ? Number(item.duracion_ms) : 1500;
  form.elements.duracion_ms.value = String(dur);
  if ($('userTimedDurRange')) $('userTimedDurRange').value = String(dur);
  form.elements.descripcion.value = editando ? item.descripcion || '' : '';
  form.elements.permitido_invitado.checked = editando ? esActivo(item.permitido_invitado) : false;

  bootstrap.Modal.getOrCreateInstance($('modalUserTimedCmd')).show();
}

function eliminarTemporizado(cmd) {
  pedirConfirmacion(
    'Eliminar movimiento temporizado',
    `¿Eliminar el movimiento "${cmd.nombre}" (${cmd.duracion_ms} ms)? Si está en uso dentro de alguna demo, el servidor bloqueará su eliminación (409).`,
    async () => {
      const res = await api.post(CONFIG.ENDPOINTS.COMANDO_ELIMINAR(cmd.id_comando));
      if (!res.ok) {
        toast(formatApiError(res, 'No se pudo eliminar el movimiento.'), 'danger');
        return;
      }
      toast('Movimiento temporizado eliminado.', 'success');
      await cargarComandosUnidad(STORE.vehiculoActivo.id_vehiculo);
      callbacks.onUnitDataChanged?.(STORE.vehiculoActivo.id_vehiculo);
    }
  );
}

// ---------------------------------------------------------------------------
// TAB 2: EDITOR VISUAL TÁCTIL DE DEMOS PRIVADAS
// ---------------------------------------------------------------------------
async function cargarDemosUnidad(idVehiculo) {
  const listWrap = $('userDemosList');
  if (listWrap) pintarEstadoVacio(listWrap, 'Cargando demos de la unidad…');

  const res = await api.obtenerDemos(idVehiculo);
  if (!res.ok) {
    STORE.demos = [];
    STORE.demoSeleccionada = null;
    pintarEstadoVacio(listWrap, `Error al cargar demos: ${formatApiError(res)}`, {
      tono: 'danger',
      onRetry: () => cargarDemosUnidad(idVehiculo),
    });
    renderEditorPasos();
    return;
  }

  STORE.demos = Array.isArray(res.data) ? res.data : [];
  if (STORE.demoSeleccionada) {
    STORE.demoSeleccionada =
      STORE.demos.find((d) => d.id_demo === STORE.demoSeleccionada.id_demo) || null;
  }
  if (!STORE.demoSeleccionada && STORE.demos.length) {
    STORE.demoSeleccionada =
      STORE.demos.find((d) => d.tipo === 'PRIVADA') || STORE.demos[0];
  }

  renderListaDemos();
  if (STORE.demoSeleccionada) {
    await cargarPasosDemo(STORE.demoSeleccionada.id_demo);
  } else {
    STORE.pasos = [];
    renderEditorPasos();
  }
}

function renderListaDemos() {
  const wrap = $('userDemosList');
  if (!wrap) return;
  wrap.textContent = '';

  if (!STORE.demos.length) {
    pintarEstadoVacio(wrap, 'Esta unidad no tiene demos todavía. Crea tu primera demo privada.');
    return;
  }

  STORE.demos.forEach((d) => {
    const esPrivada = d.tipo === 'PRIVADA';
    const activa = STORE.demoSeleccionada?.id_demo === d.id_demo;

    const card = document.createElement('div');
    card.className = `p-2 rounded border mb-2 bg-dark ${activa ? 'border-info' : 'border-secondary-subtle'}`;

    const head = document.createElement('div');
    head.className = 'd-flex justify-content-between align-items-start gap-2';

    const info = document.createElement('div');
    info.className = 'min-w-0';
    const title = document.createElement('strong');
    title.className = 'd-block text-white small text-truncate';
    title.textContent = d.nombre;
    const desc = document.createElement('small');
    desc.className = 'text-secondary d-block';
    desc.textContent = d.descripcion || 'Sin descripción';
    info.append(title, desc);

    const badge = crearBadge(
      esPrivada ? 'PRIVADA' : 'FÁBRICA · lectura',
      esPrivada
        ? 'bg-info-subtle text-info border border-info-subtle'
        : 'bg-secondary-subtle text-light border border-secondary'
    );
    head.append(info, badge);

    const btns = document.createElement('div');
    btns.className = 'd-flex flex-wrap gap-1 mt-2';
    btns.append(
      crearBoton({
        icono: 'bi-list-ol',
        texto: esPrivada ? 'Editar pasos' : 'Ver pasos',
        clase: activa ? 'btn-info text-dark fw-semibold' : 'btn-outline-info',
        onClick: async () => {
          STORE.demoSeleccionada = d;
          renderListaDemos();
          await cargarPasosDemo(d.id_demo);
        },
      }),
      crearBoton({
        icono: 'bi-play-fill',
        texto: 'Ejecutar',
        clase: 'btn-outline-success',
        onClick: () => callbacks.onExecuteDemo?.(STORE.vehiculoActivo, d),
      })
    );

    if (esPrivada) {
      btns.append(
        crearBoton({
          icono: 'bi-pencil-square',
          texto: 'Editar',
          clase: 'btn-outline-light',
          onClick: () => abrirModalDemoPrivada(d),
        }),
        crearBoton({
          icono: 'bi-trash',
          texto: 'Eliminar',
          clase: 'btn-outline-danger',
          onClick: () => eliminarDemoPrivada(d),
        })
      );
    }

    card.append(head, btns);
    wrap.appendChild(card);
  });
}

async function cargarPasosDemo(idDemo) {
  const stepsWrap = $('userDemoStepsWrap');
  if (stepsWrap) pintarEstadoVacio(stepsWrap, 'Cargando pasos de la demo…');

  const res = await api.get(CONFIG.ENDPOINTS.DEMO_MOVIMIENTOS(idDemo));
  if (!res.ok) {
    STORE.pasos = [];
    pintarEstadoVacio(stepsWrap, `Error al cargar pasos: ${formatApiError(res)}`, {
      tono: 'danger',
      onRetry: () => cargarPasosDemo(idDemo),
    });
    actualizarResumenDuracionDemo();
    return;
  }

  STORE.pasos = Array.isArray(res.data)
    ? res.data.sort((a, b) => Number(a.orden) - Number(b.orden))
    : [];
  renderEditorPasos();
}

function actualizarResumenDuracionDemo() {
  const countEl = $('userDemoStepCount');
  const totalEl = $('userDemoTotalDuration');
  const totalMs = STORE.pasos.reduce(
    (acc, p) => acc + Number(p.duracion_ms || 0) + Number(p.pausa_ms || 0),
    0
  );
  if (countEl) countEl.textContent = `${STORE.pasos.length} pasos`;
  if (totalEl) totalEl.textContent = `Duración total: ${(totalMs / 1000).toFixed(2)} s`;
}

function renderEditorPasos() {
  const demo = STORE.demoSeleccionada;
  const titleEl = $('userDemoEditorTitle');
  const btnAdd = $('btnUserAddStep');
  const btnRun = $('btnUserRunDemo');
  const btnStop = $('btnUserStopDemo');
  const wrap = $('userDemoStepsWrap');

  const editable = Boolean(demo && demo.tipo === 'PRIVADA');
  if (titleEl) {
    titleEl.textContent = demo
      ? `${demo.nombre} (${demo.tipo})`
      : 'Selecciona o crea una demo';
  }
  if (btnAdd) btnAdd.disabled = !editable;
  if (btnRun) btnRun.disabled = !demo || !STORE.pasos.length;
  if (btnStop) btnStop.disabled = !demo;

  actualizarResumenDuracionDemo();

  if (!wrap) return;
  wrap.textContent = '';

  if (!demo) {
    pintarEstadoVacio(wrap, 'Selecciona una demo de la izquierda o crea una nueva demo privada.');
    return;
  }

  if (!STORE.pasos.length) {
    pintarEstadoVacio(
      wrap,
      editable
        ? 'Esta demo privada aún no tiene pasos. Pulsa «Agregar paso» para armar tu secuencia.'
        : 'Esta demo de fábrica no tiene pasos configurados.'
    );
    return;
  }

  STORE.pasos.forEach((p, idx) => {
    const item = document.createElement('div');
    item.className = 'demo-step-editor-card p-2 rounded border border-secondary-subtle bg-dark mb-2 d-flex flex-wrap justify-content-between align-items-center gap-2';

    const left = document.createElement('div');
    left.className = 'd-flex align-items-center gap-2 min-w-0';

    const num = crearBadge(`#${p.orden}`, 'text-bg-primary font-monospace');
    const meta = CONFIG.COMMAND_META[Number(p.codigo_fisico ?? p.codigo)];

    const textBox = document.createElement('div');
    textBox.className = 'min-w-0';
    const cmdLine = document.createElement('strong');
    cmdLine.className = 'd-block text-white small';
    if (meta?.icon) {
      const ico = document.createElement('i');
      ico.className = `bi ${meta.icon} me-1 text-info`;
      ico.setAttribute('aria-hidden', 'true');
      cmdLine.appendChild(ico);
    }
    cmdLine.appendChild(
      document.createTextNode(`${p.comando || `Comando #${p.id_comando}`} (fís. ${p.codigo_fisico ?? p.codigo})`)
    );
    const durLine = document.createElement('small');
    durLine.className = 'text-secondary font-monospace';
    durLine.textContent = `Duración: ${p.duracion_ms} ms (${(Number(p.duracion_ms) / 1000).toFixed(1)}s) · Pausa: ${p.pausa_ms} ms`;
    textBox.append(cmdLine, durLine);
    left.append(num, textBox);

    const actions = document.createElement('div');
    actions.className = 'd-flex flex-wrap gap-1';
    if (editable) {
      actions.append(
        crearBoton({
          icono: 'bi-arrow-up',
          clase: 'btn-outline-secondary',
          title: 'Subir paso',
          disabled: idx === 0,
          onClick: () => moverPasoDemo(p.id_demo_movimiento, -1),
        }),
        crearBoton({
          icono: 'bi-arrow-down',
          clase: 'btn-outline-secondary',
          title: 'Bajar paso',
          disabled: idx === STORE.pasos.length - 1,
          onClick: () => moverPasoDemo(p.id_demo_movimiento, 1),
        }),
        crearBoton({
          icono: 'bi-pencil-square',
          texto: 'Editar',
          clase: 'btn-outline-info',
          onClick: () => abrirModalPasoPrivado(p),
        }),
        crearBoton({
          icono: 'bi-trash',
          texto: 'Quitar',
          clase: 'btn-outline-danger',
          onClick: () => eliminarPasoPrivado(p),
        })
      );
    } else {
      actions.appendChild(
        crearBadge('Solo lectura', 'bg-secondary-subtle text-secondary border border-secondary-subtle')
      );
    }

    item.append(left, actions);
    wrap.appendChild(item);
  });
}

async function moverPasoDemo(idMov, delta) {
  const demo = STORE.demoSeleccionada;
  if (!demo) return;
  const ids = STORE.pasos.map((p) => p.id_demo_movimiento);
  const idx = ids.indexOf(idMov);
  const target = idx + delta;
  if (idx < 0 || target < 0 || target >= ids.length) return;
  [ids[idx], ids[target]] = [ids[target], ids[idx]];

  const res = await api.post(CONFIG.ENDPOINTS.DEMO_REORDENAR(demo.id_demo), { orden_ids: ids });
  if (!res.ok) {
    toast(formatApiError(res, 'Error al reordenar pasos.'), 'danger');
    return;
  }
  toast('Orden de pasos actualizado.', 'success');
  await cargarPasosDemo(demo.id_demo);
}

function abrirModalDemoPrivada(item = null) {
  if (!STORE.vehiculoActivo) return;
  const form = $('formUserDemo');
  const editando = Boolean(item);
  form.reset();
  form.elements.id.value = editando ? String(item.id_demo) : '';
  $('modalUserDemoTitulo').textContent = editando ? 'Editar demo privada' : 'Nueva demo privada';
  form.elements.nombre.value = editando ? item.nombre || '' : '';
  form.elements.descripcion.value = editando ? item.descripcion || '' : '';
  bootstrap.Modal.getOrCreateInstance($('modalUserDemo')).show();
}

function eliminarDemoPrivada(demo) {
  pedirConfirmacion(
    'Eliminar demo privada',
    `¿Eliminar tu demo privada "${demo.nombre}" y todos sus pasos? Esta acción no se puede deshacer.`,
    async () => {
      const res = await api.post(CONFIG.ENDPOINTS.DEMO_ELIMINAR(demo.id_demo));
      if (!res.ok) {
        toast(formatApiError(res, 'No se pudo eliminar la demo.'), 'danger');
        return;
      }
      toast('Demo privada eliminada.', 'success');
      if (STORE.demoSeleccionada?.id_demo === demo.id_demo) STORE.demoSeleccionada = null;
      await cargarDemosUnidad(STORE.vehiculoActivo.id_vehiculo);
      callbacks.onUnitDataChanged?.(STORE.vehiculoActivo.id_vehiculo);
    }
  );
}

function abrirModalPasoPrivado(item = null) {
  if (!STORE.demoSeleccionada || STORE.demoSeleccionada.tipo !== 'PRIVADA') return;
  const activos = STORE.comandos.filter((c) => esActivo(c.activo));
  if (!activos.length) {
    toast('Esta unidad no tiene comandos activos disponibles.', 'warning');
    return;
  }

  const form = $('formUserDemoStep');
  const editando = Boolean(item);
  form.reset();
  form.elements.id.value = editando ? String(item.id_demo_movimiento) : '';
  $('modalUserDemoStepTitulo').textContent = editando ? 'Editar paso de demo' : 'Agregar paso a demo';

  const select = form.elements.id_comando;
  select.textContent = '';
  activos.forEach((c) => {
    const tag = c.duracion_ms ? ` · temp ${c.duracion_ms}ms` : ' · base';
    select.appendChild(
      new Option(`${c.nombre} (fís. ${c.codigo_fisico ?? c.codigo}${tag})`, String(c.id_comando))
    );
  });

  if (editando) {
    select.value = String(item.id_comando);
    form.elements.orden.value = String(item.orden);
    form.elements.duracion_ms.value = String(item.duracion_ms);
    form.elements.pausa_ms.value = String(item.pausa_ms);
  } else {
    const nextOrden = Math.max(0, ...STORE.pasos.map((p) => Number(p.orden) || 0)) + 1;
    form.elements.orden.value = String(nextOrden);
    form.elements.duracion_ms.value = '1500';
    form.elements.pausa_ms.value = '300';
  }

  bootstrap.Modal.getOrCreateInstance($('modalUserDemoStep')).show();
}

function eliminarPasoPrivado(paso) {
  pedirConfirmacion(
    'Quitar paso de demo',
    `¿Quitar el paso #${paso.orden} (${paso.comando || `Comando #${paso.id_comando}`}) de la secuencia?`,
    async () => {
      const res = await api.post(CONFIG.ENDPOINTS.MOVIMIENTO_DEMO_ELIMINAR(paso.id_demo_movimiento));
      if (!res.ok) {
        toast(formatApiError(res, 'No se pudo quitar el paso.'), 'danger');
        return;
      }
      toast('Paso eliminado.', 'success');
      await cargarPasosDemo(STORE.demoSeleccionada.id_demo);
    }
  );
}

// ---------------------------------------------------------------------------
// TAB 3: AUTORIZACIÓN DE SOPORTE TEMPORAL AL ADMINISTRADOR
// ---------------------------------------------------------------------------
async function cargarSoporteUnidad(vehiculo) {
  const avisoExh = $('userSoporteExhibicionNotice');
  const avisoText = $('userSoporteNoticeText');
  const form = $('formUserSoporte');
  const enVendido = vehiculo.estado_comercial === 'VENDIDO';

  if (avisoExh) {
    // Alternar d-flex/d-none porque Bootstrap .d-flex (!important) pisa el atributo hidden
    avisoExh.classList.toggle('d-flex', !enVendido);
    avisoExh.classList.toggle('d-none', enVendido);
    avisoExh.hidden = enVendido;
  }
  if (avisoText && !enVendido) {
    avisoText.textContent = `Esta unidad está actualmente en estado ${vehiculo.estado_comercial || 'EXHIBICION'}. Para otorgar soporte temporal al administrador primero pásala a estado VENDIDO.`;
  }
  if (form) {
    Array.from(form.elements).forEach((el) => {
      if (el.tagName === 'INPUT' || el.tagName === 'BUTTON' || el.tagName === 'TEXTAREA') {
        el.disabled = !enVendido;
      }
    });
  }

  pintarTablaMensaje('userSoporteBody', 'Consultando autorizaciones de soporte…');
  const res = await api.listarSoporte(vehiculo.id_vehiculo);
  if (!res.ok) {
    STORE.soportes = [];
    pintarTablaMensaje('userSoporteBody', `Error: ${formatApiError(res)}`, {
      tono: 'danger',
      onRetry: () => cargarSoporteUnidad(vehiculo),
    });
    return;
  }

  STORE.soportes = Array.isArray(res.data) ? res.data : [];
  const tbody = $('userSoporteBody');
  tbody.textContent = '';
  if (!STORE.soportes.length) {
    pintarTablaMensaje(
      'userSoporteBody',
      'No has otorgado autorizaciones de soporte para esta unidad.'
    );
    return;
  }

  STORE.soportes.forEach((a) => {
    const tr = document.createElement('tr');
    const esActiva = a.estado === 'ACTIVA' && Number(a.segundos_restantes || 0) > 0;
    const estadoClase = esActiva
      ? 'bg-success-subtle text-success border border-success-subtle'
      : a.estado === 'REVOCADA'
        ? 'bg-danger-subtle text-danger border border-danger-subtle'
        : 'bg-secondary-subtle text-secondary border border-secondary-subtle';

    const tdEst = document.createElement('td');
    tdEst.className = 'text-center';
    tdEst.appendChild(crearBadge(a.estado, estadoClase));

    const tdMotivo = document.createElement('td');
    tdMotivo.className = 'small';
    tdMotivo.textContent = a.motivo || '—';

    const tdInicio = document.createElement('td');
    tdInicio.className = 'font-monospace small text-center';
    tdInicio.textContent = formatearFechaHora(a.fecha_inicio);

    const tdExp = document.createElement('td');
    tdExp.className = 'font-monospace small text-center';
    tdExp.textContent = esActiva
      ? `${formatearFechaHora(a.fecha_expiracion)} (${Math.ceil(Number(a.segundos_restantes) / 60)} min)`
      : formatearFechaHora(a.fecha_expiracion);

    const tdAcc = document.createElement('td');
    tdAcc.className = 'text-end';
    if (esActiva) {
      tdAcc.appendChild(
        crearBoton({
          icono: 'bi-shield-x',
          texto: 'Revocar',
          clase: 'btn-outline-danger',
          onClick: () => revocarSoporte(a),
        })
      );
    } else {
      tdAcc.textContent = '—';
    }

    tr.append(tdEst, tdMotivo, tdInicio, tdExp, tdAcc);
    tbody.appendChild(tr);
  });
  UI.etiquetarCeldas(tbody);
}

function revocarSoporte(aut) {
  pedirConfirmacion(
    'Revocar soporte temporal',
    `¿Revocar de inmediato la autorización de soporte #${aut.id_autorizacion}? El administrador perderá acceso operativo inmediatamente.`,
    async () => {
      const res = await api.revocarSoporte(aut.id_autorizacion);
      if (!res.ok) {
        toast(formatApiError(res, 'No se pudo revocar el soporte.'), 'danger');
        return;
      }
      toast('Autorización de soporte revocada.', 'success');
      await cargarMisVehiculosModulo(STORE.vehiculoActivo.id_vehiculo);
    }
  );
}

// ---------------------------------------------------------------------------
// INICIALIZACIÓN DE EVENTOS DEL MÓDULO TIENDA (1 sola vez desde app.js)
// ---------------------------------------------------------------------------
export function initUserVehicles(cbs = {}) {
  callbacks = { ...callbacks, ...cbs };

  // Sincronizar slider y campo numérico de duración
  $('userTimedDurRange')?.addEventListener('input', (e) => {
    const inp = $('userTimedDurMs');
    if (inp) inp.value = e.target.value;
  });
  $('userTimedDurMs')?.addEventListener('input', (e) => {
    const rng = $('userTimedDurRange');
    if (rng) rng.value = e.target.value;
  });

  $('btnUserNewTimedCmd')?.addEventListener('click', () => abrirModalTemporizado());
  $('btnUserNewDemo')?.addEventListener('click', () => abrirModalDemoPrivada());
  $('btnUserAddStep')?.addEventListener('click', () => abrirModalPasoPrivado());
  $('btnUserRunDemo')?.addEventListener('click', () => {
    if (STORE.vehiculoActivo && STORE.demoSeleccionada) {
      callbacks.onExecuteDemo?.(STORE.vehiculoActivo, STORE.demoSeleccionada);
    }
  });
  $('btnUserStopDemo')?.addEventListener('click', () => {
    if (STORE.vehiculoActivo) callbacks.onCancelDemo?.(STORE.vehiculoActivo);
  });
  $('btnUserSoporteVolverVendido')?.addEventListener('click', () => {
    if (STORE.vehiculoActivo) solicitarCambioExhibicion(STORE.vehiculoActivo, false);
  });
  $('btnUserWorkspaceToggleExhibicion')?.addEventListener('click', () => {
    if (!STORE.vehiculoActivo) return;
    const habilitar = STORE.vehiculoActivo.estado_comercial !== 'EXHIBICION';
    solicitarCambioExhibicion(STORE.vehiculoActivo, habilitar);
  });
  $('btnUserWorkspaceControl')?.addEventListener('click', () => {
    if (STORE.vehiculoActivo) callbacks.onSelectForControl?.(STORE.vehiculoActivo);
  });
  $('btnUserWorkspaceMonitor')?.addEventListener('click', () => {
    if (STORE.vehiculoActivo) callbacks.onSelectForMonitor?.(STORE.vehiculoActivo);
  });
  $('btnUserBackToList')?.addEventListener('click', () => {
    if (STORE.vehiculos.length <= 1) return;
    vistaListaActiva = true;
    const workspace = $('userUnitWorkspace');
    const grid = $('userVehiclesGrid');
    if (workspace) workspace.hidden = true;
    if (grid) grid.hidden = false;
    renderTarjetasVehiculos();
  });

  // Chips rápidos de duración de soporte
  document.querySelectorAll('[data-soporte-min]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inp = $('userSoporteMinutos');
      if (inp && !inp.disabled) inp.value = btn.dataset.soporteMin;
    });
  });

  // Submit: Movimiento temporizado propio
  $('formUserTimedCmd')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!STORE.vehiculoActivo) return;
    const form = e.currentTarget;
    const editando = form.elements.id.value !== '';
    const nombre = String(form.elements.nombre.value || '').trim();
    const codigoFisico = Number(form.elements.codigo_fisico.value);
    const duracionMs = Number(form.elements.duracion_ms.value);
    const descripcion = String(form.elements.descripcion.value || '').trim() || null;
    const permitidoInvitado = Boolean(form.elements.permitido_invitado.checked);

    if (!nombre) return toast('El nombre del movimiento es obligatorio.', 'warning');
    if (!Number.isInteger(codigoFisico) || codigoFisico < 1) {
      return toast('Selecciona una acción física válida.', 'warning');
    }
    if (!Number.isInteger(duracionMs) || duracionMs < 1 || duracionMs > 10000) {
      return toast('La duración debe estar entre 1 y 10000 ms.', 'warning');
    }

    const payload = {
      nombre,
      codigo_fisico: codigoFisico,
      duracion_ms: duracionMs,
      descripcion,
      permitido_invitado: permitidoInvitado,
    };
    if (editando) payload.activo = true;

    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    const res = editando
      ? await api.post(CONFIG.ENDPOINTS.COMANDO_ACTUALIZAR(Number(form.elements.id.value)), payload)
      : await api.post(CONFIG.ENDPOINTS.COMANDOS(STORE.vehiculoActivo.id_vehiculo), payload);
    if (btn) btn.disabled = false;

    if (!res.ok) {
      toast(formatApiError(res, 'No se pudo guardar el movimiento temporizado.'), 'danger');
      return;
    }

    UI.hideModal('modalUserTimedCmd');
    toast(editando ? 'Movimiento actualizado.' : 'Movimiento temporizado creado.', 'success');
    await cargarComandosUnidad(STORE.vehiculoActivo.id_vehiculo);
    callbacks.onUnitDataChanged?.(STORE.vehiculoActivo.id_vehiculo);
  });

  // Submit: Demo privada
  $('formUserDemo')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!STORE.vehiculoActivo) return;
    const form = e.currentTarget;
    const editando = form.elements.id.value !== '';
    const nombre = String(form.elements.nombre.value || '').trim();
    const descripcion = String(form.elements.descripcion.value || '').trim() || null;
    if (!nombre) return toast('El nombre de la demo es obligatorio.', 'warning');

    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    const res = editando
      ? await api.post(CONFIG.ENDPOINTS.DEMO_ACTUALIZAR(Number(form.elements.id.value)), {
          nombre,
          descripcion,
          activo: true,
        })
      : await api.post(CONFIG.ENDPOINTS.DEMOS(STORE.vehiculoActivo.id_vehiculo), {
          nombre,
          descripcion,
          tipo: 'PRIVADA',
        });
    if (btn) btn.disabled = false;

    if (!res.ok) {
      toast(formatApiError(res, 'No se pudo guardar la demo privada.'), 'danger');
      return;
    }

    UI.hideModal('modalUserDemo');
    toast(editando ? 'Demo privada actualizada.' : 'Demo privada creada.', 'success');
    const createdId = res.data?.id_demo;
    await cargarDemosUnidad(STORE.vehiculoActivo.id_vehiculo);
    if (createdId) {
      const nueva = STORE.demos.find((d) => d.id_demo === Number(createdId));
      if (nueva) {
        STORE.demoSeleccionada = nueva;
        renderListaDemos();
        await cargarPasosDemo(nueva.id_demo);
      }
    }
    callbacks.onUnitDataChanged?.(STORE.vehiculoActivo.id_vehiculo);
  });

  // Submit: Paso de demo privada
  $('formUserDemoStep')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!STORE.demoSeleccionada) return;
    const form = e.currentTarget;
    const editando = form.elements.id.value !== '';
    const payload = {
      id_comando: Number(form.elements.id_comando.value),
      orden: Number(form.elements.orden.value),
      duracion_ms: Number(form.elements.duracion_ms.value),
      pausa_ms: Number(form.elements.pausa_ms.value),
    };
    if (!Number.isInteger(payload.id_comando) || payload.id_comando < 1) {
      return toast('Selecciona un comando.', 'warning');
    }
    if (!Number.isInteger(payload.orden) || payload.orden < 1) {
      return toast('El orden debe ser >= 1.', 'warning');
    }
    if (!Number.isInteger(payload.duracion_ms) || payload.duracion_ms < 1 || payload.duracion_ms > 10000) {
      return toast('La duración debe estar entre 1 y 10000 ms.', 'warning');
    }
    if (!Number.isInteger(payload.pausa_ms) || payload.pausa_ms < 0 || payload.pausa_ms > 10000) {
      return toast('La pausa debe estar entre 0 y 10000 ms.', 'warning');
    }

    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    const res = editando
      ? await api.post(CONFIG.ENDPOINTS.MOVIMIENTO_DEMO_ACTUALIZAR(Number(form.elements.id.value)), payload)
      : await api.post(CONFIG.ENDPOINTS.DEMO_MOVIMIENTOS(STORE.demoSeleccionada.id_demo), payload);
    if (btn) btn.disabled = false;

    if (!res.ok) {
      toast(formatApiError(res, 'No se pudo guardar el paso.'), 'danger');
      return;
    }

    UI.hideModal('modalUserDemoStep');
    toast(editando ? 'Paso actualizado.' : 'Paso agregado a la demo.', 'success');
    await cargarPasosDemo(STORE.demoSeleccionada.id_demo);
  });

  // Submit: Otorgar soporte temporal al ADMIN
  $('formUserSoporte')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!STORE.vehiculoActivo) return;
    const form = e.currentTarget;
    const motivo = String(form.elements.motivo.value || '').trim();
    const duracionMinutos = Number(form.elements.duracion_minutos.value);
    if (motivo.length < 3) return toast('Describe brevemente el motivo del soporte (mín. 3 caracteres).', 'warning');
    if (!Number.isInteger(duracionMinutos) || duracionMinutos < 1 || duracionMinutos > 1440) {
      return toast('La duración debe estar entre 1 y 1440 minutos.', 'warning');
    }

    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    const res = await api.otorgarSoporte(STORE.vehiculoActivo.id_vehiculo, {
      motivo,
      duracion_minutos: duracionMinutos,
    });
    if (btn) btn.disabled = false;

    if (!res.ok) {
      toast(formatApiError(res, 'No se pudo otorgar soporte.'), 'danger');
      return;
    }

    form.reset();
    form.elements.duracion_minutos.value = '30';
    toast('Autorización temporal de soporte otorgada al administrador.', 'success');
    await cargarMisVehiculosModulo(STORE.vehiculoActivo.id_vehiculo);
  });

  // Limpiar acción pendiente si el usuario cancela el modal de confirmación
  $('modalConfirmar')?.addEventListener('hidden.bs.modal', () => {
    confirmActionPending = null;
  });

  // Hook compartido sobre el modal de confirmación genérico: cerrar de inmediato al confirmar
  $('btnConfirmarAccion')?.addEventListener('click', async () => {
    if (!confirmActionPending) return;
    const fn = confirmActionPending;
    confirmActionPending = null;
    UI.hideModal('modalConfirmar');
    try {
      await fn();
    } catch (err) {
      toast(`Error al procesar la acción: ${err?.message || 'desconocido'}`, 'danger');
    }
  });
}
