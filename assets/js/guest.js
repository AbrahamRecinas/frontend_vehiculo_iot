/**
 * guest.js
 * Módulo completo de Cliente Final / Invitado:
 *  - Catálogo público de modelos y unidades en EXHIBICION (/api/public/modelos y /api/public/exhibicion)
 *  - Reserva exclusiva temporal (POST /api/invitados/sesiones) con manejo de 409 Conflict
 *  - Banner fijo con contador regresivo en vivo (mm:ss) y botón «Finalizar prueba»
 *  - Filtrado de controles permitidos (permitido_invitado = 1 + DETENER 12)
 *  - Cierre automático al vencer el reloj o desconectar WSS (emite DETENER y libera unidad)
 * Todo dato de API se renderiza exclusivamente con textContent.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';
import { auth } from './auth.js';
import { api, formatApiError } from './api.js';
import { UI } from './ui.js?v=4.3.4';

const DEFAULT_MODEL_IMG = './assets/img/modelo-default.svg';
const GRUA_MODEL_IMG = './assets/img/modelo-grua.svg';

function resolverImagenModelo(obj) {
  const url = String(obj?.url_imagen || '').trim();
  if (url) return url;
  const texto = `${obj?.codigo_modelo || ''} ${obj?.nombre_comercial || ''} ${obj?.nombre || ''}`.toUpperCase();
  return texto.includes('GRUA') || texto.includes('GRÚA') ? GRUA_MODEL_IMG : DEFAULT_MODEL_IMG;
}

function crearImagenModelo(obj, altTexto) {
  const img = document.createElement('img');
  img.src = resolverImagenModelo(obj);
  img.alt = altTexto || 'Vehículo RC IoT';
  img.className = 'catalog-model-img rounded';
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    if (!img.dataset.fallbackApplied) {
      img.dataset.fallbackApplied = '1';
      img.src = DEFAULT_MODEL_IMG;
    }
  });
  return img;
}

const $ = (id) => document.getElementById(id);
const toast = (msg, tipo = 'info') => UI.showToast(msg, tipo);

let countdownInterval = null;
let expiresAtMs = 0;
let finishing = false;
let callbacks = {
  onSessionStarted: null,
  onSessionEnded: null,
};

function formatMMSS(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function crearEstadoMensaje(container, texto, { tono = 'secondary', onRetry = null } = {}) {
  if (!container) return;
  container.textContent = '';
  const col = document.createElement('div');
  col.className = 'col-12';
  const box = document.createElement('div');
  box.className = `p-3 rounded border border-secondary-subtle bg-dark text-center small text-${tono}`;
  const p = document.createElement('p');
  p.className = onRetry ? 'mb-2' : 'mb-0';
  p.textContent = texto;
  box.appendChild(p);
  if (onRetry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-outline-info';
    const ico = document.createElement('i');
    ico.className = 'bi bi-arrow-clockwise me-1';
    ico.setAttribute('aria-hidden', 'true');
    btn.append(ico, document.createTextNode('Reintentar'));
    btn.addEventListener('click', onRetry);
    box.appendChild(btn);
  }
  col.appendChild(box);
  container.appendChild(col);
}

// ---------------------------------------------------------------------------
// 1. CATÁLOGO PÚBLICO DE MODELOS Y UNIDADES EN EXHIBICIÓN
// ---------------------------------------------------------------------------
export async function cargarCatalogoInvitado() {
  const modelosWrap = $('guestModelosGrid');
  const exhibWrap = $('guestExhibicionGrid');
  if (modelosWrap) crearEstadoMensaje(modelosWrap, 'Cargando modelos del catálogo público…');
  if (exhibWrap) crearEstadoMensaje(exhibWrap, 'Consultando disponibilidad real en exhibición…');

  const [modRes, exhRes] = await Promise.all([
    api.obtenerCatalogoPublicoModelos(),
    api.obtenerCatalogoPublicoExhibicion(),
  ]);

  if (modelosWrap) {
    if (!modRes.ok) {
      crearEstadoMensaje(modelosWrap, `Error al cargar modelos: ${formatApiError(modRes)}`, {
        tono: 'danger',
        onRetry: cargarCatalogoInvitado,
      });
    } else {
      const modelos = Array.isArray(modRes.data) ? modRes.data : [];
      modelosWrap.textContent = '';
      if (!modelos.length) {
        crearEstadoMensaje(modelosWrap, 'No hay modelos publicados en este momento.');
      } else {
        modelos.forEach((m) => {
          const col = document.createElement('div');
          col.className = 'col-12';

          const card = document.createElement('div');
          card.className = 'card bg-dark border-secondary-subtle guest-item-card';
          const body = document.createElement('div');
          body.className = 'card-body p-2 guest-card-media';

          const info = document.createElement('div');
          info.className = 'guest-card-body min-w-0 flex-grow-1';

          const head = document.createElement('div');
          head.className = 'd-flex justify-content-between align-items-start gap-2 mb-1';
          const h3 = document.createElement('h3');
          h3.className = 'h6 text-white fw-bold mb-0 text-truncate';
          h3.textContent = m.nombre_comercial || m.codigo_modelo;
          const code = document.createElement('span');
          code.className = 'badge text-bg-dark border border-secondary font-monospace flex-shrink-0';
          code.textContent = m.codigo_modelo;
          head.append(h3, code);

          const desc = document.createElement('p');
          desc.className = 'small text-secondary mb-1 guest-card-desc';
          desc.textContent = m.descripcion || 'Vehículo RC IoT oficial.';

          const caps = document.createElement('div');
          caps.className = 'd-flex flex-wrap gap-1';
          const listaCaps = Array.isArray(m.capacidades) ? m.capacidades : [];
          const permitidas = listaCaps.filter((c) => c.permitido_invitado_default === 1 || c.permitido_invitado_default === true);
          const chip1 = document.createElement('span');
          chip1.className = 'badge bg-info-subtle text-info border border-info-subtle';
          chip1.textContent = `${listaCaps.length} funciones`;
          const chip2 = document.createElement('span');
          chip2.className = 'badge bg-primary-subtle text-primary border border-primary-subtle';
          chip2.textContent = `${permitidas.length} en prueba`;
          caps.append(chip1, chip2);

          const img = crearImagenModelo(m, m.nombre_comercial || m.codigo_modelo);
          info.append(head, desc, caps);
          body.append(img, info);
          card.appendChild(body);
          col.appendChild(card);
          modelosWrap.appendChild(col);
        });
      }
    }
  }

  if (exhibWrap) {
    if (!exhRes.ok) {
      crearEstadoMensaje(exhibWrap, `Error al consultar unidades en exhibición: ${formatApiError(exhRes)}`, {
        tono: 'danger',
        onRetry: cargarCatalogoInvitado,
      });
    } else {
      const unidades = Array.isArray(exhRes.data) ? exhRes.data : [];
      exhibWrap.textContent = '';
      if (!unidades.length) {
        crearEstadoMensaje(
          exhibWrap,
          'Actualmente no hay unidades habilitadas en modo EXHIBICIÓN. Pide al administrador o tienda habilitar una unidad.'
        );
      } else {
        const durSelect = $('guestDuracionSelect');
        unidades.forEach((u) => {
          const col = document.createElement('div');
          col.className = 'col-12';

          const card = document.createElement('div');
          card.className = `card bg-dark guest-item-card ${u.disponible_ahora ? 'border-success-subtle' : 'border-warning-subtle'}`;
          const body = document.createElement('div');
          body.className = 'card-body p-2 guest-card-media';

          const info = document.createElement('div');
          info.className = 'guest-card-body min-w-0 flex-grow-1 d-flex flex-column gap-1';

          const top = document.createElement('div');
          top.className = 'd-flex justify-content-between align-items-center gap-2';
          const title = document.createElement('strong');
          title.className = 'text-white small text-truncate';
          title.textContent = `${u.nombre} (#${u.id_vehiculo})`;

          const badge = document.createElement('span');
          badge.className = u.disponible_ahora
            ? 'badge bg-success-subtle text-success border border-success-subtle flex-shrink-0'
            : 'badge bg-warning-subtle text-warning border border-warning-subtle flex-shrink-0';
          badge.textContent = u.disponible_ahora
            ? 'Disponible'
            : `Ocupado (${formatMMSS(u.segundos_ocupacion)})`;
          top.append(title, badge);

          const sub = document.createElement('small');
          sub.className = 'text-secondary guest-card-desc';
          sub.textContent = `${u.nombre_comercial || u.modelo || 'Unidad de exhibición'}${
            u.descripcion ? ` · ${u.descripcion}` : ''
          }`;

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = u.disponible_ahora
            ? 'btn btn-success btn-sm fw-semibold mt-1 align-self-start'
            : 'btn btn-outline-secondary btn-sm mt-1 align-self-start';
          btn.disabled = !u.disponible_ahora;
          const ico = document.createElement('i');
          ico.className = `bi ${u.disponible_ahora ? 'bi-play-circle-fill' : 'bi-lock-fill'} me-1`;
          ico.setAttribute('aria-hidden', 'true');
          btn.append(
            ico,
            document.createTextNode(u.disponible_ahora ? 'Probar ahora' : 'En uso por otro visitante')
          );

          if (u.disponible_ahora) {
            btn.addEventListener('click', () => {
              const durSeg = Number(durSelect?.value || 180);
              reservarUnidadInvitado(u, durSeg, btn);
            });
          }

          const img = crearImagenModelo(u, u.nombre || u.nombre_comercial);

          const hwRow = document.createElement('div');
          hwRow.className = 'd-flex flex-wrap align-items-center gap-2';
          const hwIndicator = document.createElement('span');
          const hwOnline = u.dispositivo_conectado === true || u.dispositivo_conectado === 1;
          hwIndicator.className = `hw-indicator ${hwOnline ? 'hw-indicator--online' : 'hw-indicator--offline'}`;
          const hwDot = document.createElement('span');
          hwDot.className = 'hw-dot';
          hwDot.setAttribute('aria-hidden', 'true');
          hwIndicator.append(hwDot, document.createTextNode(hwOnline ? 'Hardware en línea' : 'Hardware sin enlace'));
          hwRow.appendChild(hwIndicator);

          info.append(top, hwRow, sub, btn);
          body.append(img, info);
          card.appendChild(body);
          col.appendChild(card);
          exhibWrap.appendChild(col);
        });
      }
    }
  }
}

async function reservarUnidadInvitado(unidad, duracionSeg, btn) {
  const dur = Math.min(3600, Math.max(30, Number(duracionSeg) || 180));
  if (btn) btn.disabled = true;

  const res = await api.iniciarSesionInvitado({
    id_vehiculo: unidad.id_vehiculo,
    duracion_limite_seg: dur,
  });

  if (btn) btn.disabled = false;

  if (!res.ok) {
    if (res.status === 409) {
      toast(
        formatApiError(res, 'Esta unidad acaba de ser reservada por otro visitante (409).'),
        'warning'
      );
      await cargarCatalogoInvitado();
      return;
    }
    toast(formatApiError(res, 'No se pudo iniciar la sesión de prueba.'), 'danger');
    return;
  }

  const data = res.data || {};
  const sesionInvitado = {
    id_sesion: data.id_sesion,
    id_vehiculo: data.id_vehiculo,
    vehiculo_nombre: unidad.nombre,
    identificador_invitado: data.identificador_invitado,
    duracion_limite_seg: data.duracion_limite_seg,
    segundos_restantes: data.segundos_restantes ?? data.duracion_limite_seg,
    fecha_expiracion: data.fecha_expiracion,
    estado: data.estado || 'ACTIVA',
  };

  // Guardar sesión de invitado en sessionStorage (resiste F5 mientras no venza)
  auth.setSession(
    {
      accessToken: data.access_token,
      refreshToken: null,
      usuario: data.usuario || {
        id_usuario: 3,
        nombre: 'Invitado',
        correo: 'invitado@test.local',
        rol: 'INVITADO',
        activo: true,
      },
      sesionInvitado,
    },
    'guest_session_start'
  );

  toast(
    `Reserva exclusiva activada en ${unidad.nombre} (${formatMMSS(sesionInvitado.segundos_restantes)}).`,
    'success'
  );
  iniciarTemporizadorInvitado(sesionInvitado);
  callbacks.onSessionStarted?.(sesionInvitado);
}

// ---------------------------------------------------------------------------
// 2. BANNER FIJO + CONTADOR REGRESIVO EN VIVO (mm:ss) + CIERRE SEGURO
// ---------------------------------------------------------------------------
export function iniciarTemporizadorInvitado(sesionInvitado) {
  detenerTemporizadorInvitado();
  if (!sesionInvitado || !sesionInvitado.id_sesion) return;

  const segundos = Math.max(0, Number(sesionInvitado.segundos_restantes ?? sesionInvitado.duracion_limite_seg ?? 0));
  expiresAtMs = Date.now() + segundos * 1000;

  mostrarBannerInvitado(true, sesionInvitado.vehiculo_nombre || `Unidad #${sesionInvitado.id_vehiculo}`);
  actualizarRelojBanner();

  countdownInterval = setInterval(() => {
    const restantes = Math.ceil((expiresAtMs - Date.now()) / 1000);
    actualizarRelojBanner(restantes);
    if (restantes <= 0) {
      finalizarPruebaInvitado('Tiempo de prueba agotado. Unidad detenida y liberada.');
    }
  }, 1000);
}

export function detenerTemporizadorInvitado() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  expiresAtMs = 0;
  mostrarBannerInvitado(false);
}

function mostrarBannerInvitado(visible, nombreUnidad = '') {
  const banner = $('guestSessionBanner');
  if (!banner) return;
  banner.classList.toggle('d-flex', visible);
  banner.classList.toggle('d-none', !visible);
  banner.hidden = !visible;
  const label = $('guestBannerUnit');
  if (label && nombreUnidad) label.textContent = nombreUnidad;
}

function actualizarRelojBanner(explicitSec = null) {
  const el = $('guestCountdownTimer');
  if (!el) return;
  const sec = explicitSec !== null ? explicitSec : Math.ceil((expiresAtMs - Date.now()) / 1000);
  el.textContent = formatMMSS(sec);
  el.classList.toggle('text-danger', sec <= 20);
  el.classList.toggle('text-warning', sec > 20 && sec <= 60);
  el.classList.toggle('text-info', sec > 60);
}

export async function finalizarPruebaInvitado(mensaje = 'Prueba finalizada. Comando DETENER (12) emitido.') {
  if (finishing) return;
  finishing = true;
  detenerTemporizadorInvitado();
  clearGuestControlRestrictions();

  try {
    if (auth.isAuthenticated() && auth.getRole() === 'INVITADO') {
      await api.cerrarSesionInvitado();
    }
  } catch (_) {
    // continuar con limpieza local
  } finally {
    auth.clearSession('guest_ended', { notify: false });
    finishing = false;
    toast(mensaje, 'info');
    callbacks.onSessionEnded?.();
  }
}

// ---------------------------------------------------------------------------
// 3. FILTRADO VISUAL DE CONTROLES PERMITIDOS PARA INVITADO (solo permitido_invitado=1 + DETENER 12)
// ---------------------------------------------------------------------------
export function applyGuestControlRestrictions(comandosPermitidos = []) {
  const permitidosFisicos = new Set([CONFIG.COMMANDS.DETENER]); // DETENER (12) siempre activo
  (comandosPermitidos || []).forEach((c) => {
    const cf = Number(c.codigo_fisico ?? c.codigo);
    if (Number.isInteger(cf)) permitidosFisicos.add(cf);
  });

  // Filtrar botones con data-cmd (energía, accesorios y D-Pad)
  document.querySelectorAll('#mandoView [data-cmd]').forEach((btn) => {
    const cf = Number(btn.dataset.cmd);
    const allowed = permitidosFisicos.has(cf);
    btn.disabled = !allowed;
    btn.classList.toggle('guest-cmd-blocked', !allowed);
    btn.title = allowed ? '' : 'Comando restringido en modo invitado';
  });

  // Verificar si el joystick tiene al menos una dirección permitida (1, 2, 7, 8)
  const dirPerm = [1, 2, 7, 8].some((cf) => permitidosFisicos.has(cf));
  const joyCard = $('joystickPanel');
  if (joyCard) {
    joyCard.classList.toggle('guest-cmd-blocked', !dirPerm);
  }
}

export function clearGuestControlRestrictions() {
  const demoCard = $('demoCard');
  if (demoCard) demoCard.hidden = false;

  document.querySelectorAll('#mandoView [data-cmd]').forEach((btn) => {
    btn.disabled = false;
    btn.classList.remove('guest-cmd-blocked');
  });

  const joyCard = $('joystickPanel');
  if (joyCard) joyCard.classList.remove('guest-cmd-blocked');
}

export function initGuestModule(cbs = {}) {
  callbacks = { ...callbacks, ...cbs };

  $('btnGuestFinish')?.addEventListener('click', () => {
    finalizarPruebaInvitado('Has finalizado la prueba exclusiva. Unidad detenida y liberada.');
  });
}
