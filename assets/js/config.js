/**
 * config.js
 * Configuración central e inmutable de la aplicación de control IoT.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

export const CONFIG = Object.freeze({
  // Identificador del vehículo
  VEHICLE_ID: 1,

  // URLs provistas y verificadas
  BASE_URL: 'https://grua-abraham.duckdns.org',
  WSS_URL: 'wss://grua-abraham.duckdns.org/ws/vehiculo/1',
  DOCS_URL: 'https://grua-abraham.duckdns.org/docs',

  // Ruta de comprobación de la API (acordada con el backend en /docs)
  HEALTH_PATH: '/docs',

  // Rutas REST
  ENDPOINTS: Object.freeze({
    MOVIMIENTO: (id = 1) => `/api/vehiculos/${id}/movimiento`,
    CANCELAR_DEMO: (id = 1) => `/api/vehiculos/${id}/demo/cancelar`,
    COMANDOS: (id = 1) => `/api/vehiculos/${id}/comandos`,
    DEMOS: (id = 1) => `/api/vehiculos/${id}/demos`,
    DEMO_INICIAR: (id = 1) => `/api/vehiculos/${id}/demo`,
    ESTADO: (id = 1) => `/api/vehiculos/${id}/estado`,
    HISTORIAL: (id = 1) => `/api/vehiculos/${id}/historial`,
  }),

  // Catálogo completo de comandos del vehículo
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

  // Metadatos amigables para renderizado e inspección
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
    13: { id: 13, label: 'Encender',            icon: 'bi-lightning-charge',        category: 'energia' },
    14: { id: 14, label: 'Apagar',              icon: 'bi-power',                  category: 'energia' },
  }),

  // Parámetros de temporización y resiliencia de red
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
