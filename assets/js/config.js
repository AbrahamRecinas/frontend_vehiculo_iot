/**
 * config.js
 * Configuración central de la aplicación IoT con autodetección segura de entorno
 * (local 127.0.0.1:8000 para pruebas vs producción AWS grua-abraham.duckdns.org).
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

const PRESETS = Object.freeze({
  prod: Object.freeze({
    env: 'prod',
    baseUrl: 'https://grua-abraham.duckdns.org',
    wssBaseUrl: 'wss://grua-abraham.duckdns.org',
  }),
  local: Object.freeze({
    env: 'local',
    baseUrl: 'http://127.0.0.1:8000',
    wssBaseUrl: 'ws://127.0.0.1:8000',
  }),
});

function resolveEnvironment() {
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

  let requested = null;
  try {
    const params = new URLSearchParams(window.location.search);
    const paramEnv = params.get('api');
    if (paramEnv === 'local' || paramEnv === 'prod') {
      requested = paramEnv;
      sessionStorage.setItem('iot_api_env', paramEnv);
    } else {
      const saved = sessionStorage.getItem('iot_api_env');
      if (saved === 'local' || saved === 'prod') requested = saved;
    }
  } catch (_) {
    // sessionStorage o URLSearchParams no disponible
  }

  // En GitHub Pages (origen no local), nunca permitir downgrade inseguro a HTTP local
  if (!isLocalHost) {
    return PRESETS.prod;
  }

  return requested === 'prod' ? PRESETS.prod : PRESETS.local;
}

const ACTIVE_ENV = resolveEnvironment();

export const CONFIG = Object.freeze({
  ENV: ACTIVE_ENV.env,
  VEHICLE_ID: 1,

  BASE_URL: ACTIVE_ENV.baseUrl,
  WSS_BASE_URL: ACTIVE_ENV.wssBaseUrl,
  WSS_URL: `${ACTIVE_ENV.wssBaseUrl}/ws/vehiculo/1`,

  HEALTH_PATH: '/api/health',

  buildWssUrl: (id = 1, token = '') => {
    const base = `${ACTIVE_ENV.wssBaseUrl}/ws/vehiculo/${id}`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },

  buildDisplayWssUrl: (id = 1) => `${ACTIVE_ENV.wssBaseUrl}/ws/vehiculo/${id}`,

  ENDPOINTS: Object.freeze({
    // Salud independiente API AWS + Amazon RDS
    HEALTH: '/api/health',

    // Autenticación JWT real
    AUTH_LOGIN: '/api/auth/login',
    AUTH_REFRESH: '/api/auth/refresh',
    AUTH_LOGOUT: '/api/auth/logout',
    AUTH_ME: '/api/auth/me',

    // Catálogo público e invitados
    PUBLIC_MODELOS: '/api/public/modelos',
    PUBLIC_EXHIBICION: '/api/public/exhibicion',
    INVITADO_SESIONES: '/api/invitados/sesiones',
    INVITADO_ACTUAL: '/api/invitados/sesiones/actual',
    INVITADO_CERRAR: '/api/invitados/sesiones/cerrar',
    INVITADO_CANCELAR_ADMIN: (idSesion) => `/api/invitados/sesiones/${idSesion}/cancelar`,

    // Vehículos, control y monitoreo
    VEHICULOS: '/api/vehiculos/',
    VEHICULO: (id = 1) => `/api/vehiculos/${id}`,
    VEHICULO_ACTUALIZAR: (id = 1) => `/api/vehiculos/${id}/actualizar`,
    VEHICULO_ELIMINAR: (id = 1) => `/api/vehiculos/${id}/eliminar`,
    VEHICULO_ASIGNAR: (id = 1) => `/api/vehiculos/${id}/asignar-propietario`,
    VEHICULO_PROPIETARIOS_HISTORIAL: (id = 1) => `/api/vehiculos/${id}/propietarios-historial`,
    MOVIMIENTO: (id = 1) => `/api/vehiculos/${id}/movimiento`,
    CANCELAR_DEMO: (id = 1) => `/api/vehiculos/${id}/demo/cancelar`,
    COMANDOS: (id = 1) => `/api/vehiculos/${id}/comandos`,
    COMANDO_ACTUALIZAR: (idCmd) => `/api/vehiculos/comandos/${idCmd}/actualizar`,
    COMANDO_ELIMINAR: (idCmd) => `/api/vehiculos/comandos/${idCmd}/eliminar`,
    DEMOS: (id = 1) => `/api/vehiculos/${id}/demos`,
    DEMO_ACTUALIZAR: (idDemo) => `/api/vehiculos/demos/${idDemo}/actualizar`,
    DEMO_ELIMINAR: (idDemo) => `/api/vehiculos/demos/${idDemo}/eliminar`,
    DEMO_MOVIMIENTOS: (idDemo) => `/api/vehiculos/demos/${idDemo}/movimientos`,
    DEMO_REORDENAR: (idDemo) => `/api/vehiculos/demos/${idDemo}/movimientos/reordenar`,
    MOVIMIENTO_DEMO_ACTUALIZAR: (idMov) => `/api/vehiculos/movimientos_demo/${idMov}/actualizar`,
    MOVIMIENTO_DEMO_ELIMINAR: (idMov) => `/api/vehiculos/movimientos_demo/${idMov}/eliminar`,
    DEMO_INICIAR: (id = 1) => `/api/vehiculos/${id}/demo`,
    ESTADO: (id = 1) => `/api/vehiculos/${id}/estado`,
    HISTORIAL: (id = 1) => `/api/vehiculos/${id}/historial`,

    // Modelos y capacidades
    MODELOS: '/api/modelos/',
    MODELO: (id) => `/api/modelos/${id}`,
    MODELO_ACTUALIZAR: (id) => `/api/modelos/${id}/actualizar`,
    MODELO_ELIMINAR: (id) => `/api/modelos/${id}/eliminar`,
    MODELO_CAPACIDADES: (id) => `/api/modelos/${id}/capacidades`,
    CAPACIDAD_ACTUALIZAR: (idCap) => `/api/modelos/capacidades/${idCap}/actualizar`,
    CAPACIDAD_ELIMINAR: (idCap) => `/api/modelos/capacidades/${idCap}/eliminar`,

    // Usuarios (ADMIN)
    USUARIOS: '/api/usuarios/',
    USUARIO_ACTUALIZAR: (id) => `/api/usuarios/${id}/actualizar`,
    USUARIO_DESACTIVAR: (id) => `/api/usuarios/${id}/desactivar`,

    // Soporte temporal
    SOPORTE_LISTAR: (idVeh) => `/api/vehiculos/${idVeh}/soporte`,
    SOPORTE_OTORGAR: (idVeh) => `/api/vehiculos/${idVeh}/soporte/otorgar`,
    SOPORTE_REVOCAR: (idAut) => `/api/soporte/${idAut}/revocar`,

    // Auditoría y dashboard (ADMIN)
    AUDITORIA: '/api/auditoria/',
    ADMIN_DASHBOARD: '/api/admin/dashboard',
  }),

  // Códigos físicos base del hardware (conservados de 4.1/4.2)
  COMMANDS: Object.freeze({
    AVANZAR: 1,
    RETROCEDER: 2,
    GIRAR_DERECHA: 3,
    GIRAR_IZQUIERDA: 4,
    ALZAR_PALA: 5,
    BAJAR_PALA: 6,
    DIAGONAL_DERECHA: 7,
    DIAGONAL_IZQUIERDA: 8,
    LUCES: 9,
    SONIDO: 10,
    DEMO_FABRICA: 11,
    DETENER: 12,
    ENCENDER: 13,
    APAGAR: 14,
  }),

  // Metadatos visuales indexados por codigo_fisico
  COMMAND_META: Object.freeze({
    1:  { id: 1,  label: 'Avanzar',            icon: 'bi-arrow-up',               category: 'movimiento' },
    2:  { id: 2,  label: 'Retroceder',          icon: 'bi-arrow-down',             category: 'movimiento' },
    3:  { id: 3,  label: 'Girar Derecha',       icon: 'bi-arrow-clockwise',        category: 'movimiento' },
    4:  { id: 4,  label: 'Girar Izquierda',     icon: 'bi-arrow-counterclockwise', category: 'movimiento' },
    5:  { id: 5,  label: 'Alzar Pala',          icon: 'bi-arrow-bar-up',           category: 'pala' },
    6:  { id: 6,  label: 'Bajar Pala',          icon: 'bi-arrow-bar-down',         category: 'pala' },
    7:  { id: 7,  label: 'Diagonal Derecha',    icon: 'bi-arrow-up-right',         category: 'diagonal' },
    8:  { id: 8,  label: 'Diagonal Izquierda',  icon: 'bi-arrow-up-left',          category: 'diagonal' },
    9:  { id: 9,  label: 'Luces',               icon: 'bi-lightbulb',              category: 'auxiliar' },
    10: { id: 10, label: 'Sonido',              icon: 'bi-megaphone',              category: 'auxiliar' },
    11: { id: 11, label: 'Demo Fábrica',        icon: 'bi-play-circle',            category: 'demo' },
    12: { id: 12, label: 'DETENER',             icon: 'bi-stop-circle',            category: 'seguridad' },
    13: { id: 13, label: 'Encender',            icon: 'bi-lightning-charge',       category: 'energia' },
    14: { id: 14, label: 'Apagar',              icon: 'bi-power',                  category: 'energia' },
  }),

  TIMING: Object.freeze({
    REST_TIMEOUT_MS: 8000,
    MOVEMENT_TIMEOUT_MS: 5000,
    HEALTH_POLL_INTERVAL_MS: 30000,
    WS_INITIAL_RECONNECT_DELAY_MS: 1500,
    WS_MAX_RECONNECT_DELAY_MS: 15000,
    WS_RECONNECT_JITTER: 0.25,
    ACTION_DEBOUNCE_MS: 350,
  }),
});
