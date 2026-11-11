/**
 * api.js
 * Cliente HTTP REST para comunicación con la API FastAPI en AWS.
 * Implementa Fetch API, async/await, AbortController y taxonomía de errores.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';

class ApiService {
  constructor() {
    this.baseUrl = CONFIG.BASE_URL;
    this.vehicleId = CONFIG.VEHICLE_ID;
  }

  /**
   * Envoltorio genérico de fetch con AbortController, timeout y diagnóstico.
   * @param {string} endpoint - Ruta relativa al BASE_URL
   * @param {RequestInit} [options={}] - Opciones de fetch estándar
   * @param {number} [timeoutMs=CONFIG.TIMING.REST_TIMEOUT_MS] - Tiempo límite
   * @returns {Promise<{ ok: boolean, status: number, data: any, latencyMs: number, error?: string }>}
   */
  async request(endpoint, options = {}, timeoutMs = CONFIG.TIMING.REST_TIMEOUT_MS) {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const startTime = performance.now();
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });

      const latencyMs = Math.round(performance.now() - startTime);

      let data = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          data = await response.json();
        } catch (_) {
          data = null;
        }
      } else {
        // En caso de /docs o respuestas de texto
        try {
          data = await response.text();
        } catch (_) {
          data = null;
        }
      }

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          data,
          latencyMs,
          error: `Error HTTP ${response.status}: ${response.statusText || 'Error en servidor'}`,
        };
      }

      return {
        ok: true,
        status: response.status,
        data,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - startTime);
      let errorMsg = 'Error de conexión desconocido';

      if (err.name === 'AbortError') {
        errorMsg = `Tiempo de espera agotado (${timeoutMs} ms)`;
      } else if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
        errorMsg = 'Error de red o bloqueo por CORS en el backend';
      } else if (err.message) {
        errorMsg = err.message;
      }

      return {
        ok: false,
        status: 0,
        data: null,
        latencyMs,
        error: errorMsg,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Envía un comando de acción / movimiento.
   * POST /api/vehiculos/{id}/movimiento -> {"id_comando": X}
   * @param {number} idComando
   * @param {{ keepalive?: boolean, timeoutMs?: number }} [opts={}]
   */
  async enviarMovimiento(idComando, opts = {}) {
    const endpoint = CONFIG.ENDPOINTS.MOVIMIENTO(this.vehicleId);
    const body = JSON.stringify({ id_comando: Number(idComando) });

    const fetchOptions = {
      method: 'POST',
      body,
    };

    if (opts.keepalive) {
      fetchOptions.keepalive = true;
    }

    const timeout = opts.timeoutMs || (idComando === CONFIG.COMMANDS.DETENER ? 4000 : CONFIG.TIMING.MOVEMENT_TIMEOUT_MS);
    return this.request(endpoint, fetchOptions, timeout);
  }

  /**
   * Inicia una rutina de demostración específica.
   * POST /api/vehiculos/{id_vehiculo}/demo
   * Body: { "id_demo": X }
   */
  async iniciarDemo(idDemoSeleccionada) {
    const endpoint = CONFIG.ENDPOINTS.DEMO_INICIAR(this.vehicleId);

    return this.request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_demo: parseInt(idDemoSeleccionada) }),
    });
  }

  /**
   * Cancela la rutina de demostración en ejecución.
   * POST /api/vehiculos/{id}/demo/cancelar
   */
  async cancelarDemo() {
    const endpoint = CONFIG.ENDPOINTS.CANCELAR_DEMO(this.vehicleId);
    return this.request(endpoint, { method: 'POST' });
  }

  /**
   * Consulta el catálogo de comandos soportados por el vehículo.
   * GET /api/vehiculos/{id}/comandos
   */
  async obtenerComandos() {
    const endpoint = CONFIG.ENDPOINTS.COMANDOS(this.vehicleId);
    return this.request(endpoint, { method: 'GET' });
  }

  /**
   * Consulta el catálogo de rutinas de demostración disponibles.
   * GET /api/vehiculos/{id}/demos
   */
  async obtenerDemos() {
    const endpoint = CONFIG.ENDPOINTS.DEMOS(this.vehicleId);
    console.log("Iniciando petición GET a Demos...");
    const res = await this.request(endpoint, { method: 'GET' });
    console.log("Respuesta recibida:", res.data);

    if (!res.ok) {
      // Diagnóstico del fallo: se detiene el spinner en el UI y se registra el error exacto
      console.error(`[API] Error en GET ${endpoint}: HTTP ${res.status} - ${res.error}`);
    }

    return res;
  }

  /**
   * Comprueba la disponibilidad del servidor AWS realizando un GET a /docs.
   * @returns {Promise<{ ok: boolean, status: number, latencyMs: number, error?: string }>}
   */
  async comprobarSaludApi() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const startTime = performance.now();

    try {
      const response = await fetch(`${this.baseUrl}${CONFIG.HEALTH_PATH}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });

      const latencyMs = Math.round(performance.now() - startTime);

      return {
        ok: response.ok,
        status: response.status,
        latencyMs,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - startTime);
      let errorMsg = 'Inalcanzable';
      if (err.name === 'AbortError') {
        errorMsg = 'Timeout (>6s)';
      } else if (err instanceof TypeError) {
        errorMsg = 'Bloqueo CORS / Red';
      }
      return {
        ok: false,
        status: 0,
        latencyMs,
        error: errorMsg,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const api = new ApiService();
