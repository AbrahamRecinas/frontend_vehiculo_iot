/**
 * api.js
 * Cliente HTTP REST modular para FastAPI + JWT + refresh transparente en 401.
 * Incluye verificación independiente de API AWS y Amazon RDS vía GET /api/health.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';
import { auth } from './auth.js';

export function formatApiError(res, fallback = 'Error en la comunicación con el servidor') {
  const detail = res?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const loc = Array.isArray(d?.loc) ? d.loc.slice(1).join('.') : '';
        return loc ? `${loc}: ${d.msg}` : d?.msg || 'Dato inválido';
      })
      .join('; ');
  }
  return res?.error || fallback;
}

class ApiService {
  constructor() {
    this.baseUrl = CONFIG.BASE_URL;
    this.vehicleId = CONFIG.VEHICLE_ID;
  }

  setVehicleId(id) {
    const num = Number(id);
    if (Number.isInteger(num) && num > 0) {
      this.vehicleId = num;
    }
  }

  getVehicleId() {
    return this.vehicleId;
  }

  /**
   * Envoltorio central de fetch con Bearer JWT, refresh automático en 401 y timeout.
   */
  async request(
    endpoint,
    options = {},
    timeoutMs = CONFIG.TIMING.REST_TIMEOUT_MS,
    { skipAuth = false, _isRetry = false } = {}
  ) {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const headers = {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    };

    if (!skipAuth) {
      const token = auth.getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    const startTime = performance.now();
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers,
      });

      const latencyMs = Math.round(performance.now() - startTime);

      let data = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json().catch(() => null);
      } else {
        data = await response.text().catch(() => null);
      }

      // Renovación transparente ante 401 si existe refresh_token
      if (response.status === 401 && !skipAuth && !_isRetry) {
        if (auth.getRefreshToken()) {
          const refreshed = await auth.refresh();
          if (refreshed) {
            clearTimeout(timeoutId);
            return this.request(endpoint, options, timeoutMs, {
              skipAuth,
              _isRetry: true,
            });
          }
        }
        if (auth.isAuthenticated()) {
          auth.clearSession('expired');
        }
      }

      if (!response.ok) {
        const detail =
          typeof data?.detail === 'string'
            ? data.detail
            : `Error HTTP ${response.status}: ${response.statusText || 'Error en servidor'}`;
        return {
          ok: false,
          status: response.status,
          data,
          latencyMs,
          error: detail,
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

  get(endpoint, opts = {}) {
    return this.request(endpoint, { method: 'GET' }, opts.timeoutMs, opts);
  }

  post(endpoint, body = null, opts = {}) {
    return this.request(
      endpoint,
      {
        method: 'POST',
        ...(body !== null && body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(opts.keepalive ? { keepalive: true } : {}),
      },
      opts.timeoutMs,
      opts
    );
  }

  // ---------------------------------------------------------------------------
  // Salud independiente: API AWS + Amazon RDS (público, con 1 reintento suave)
  // ---------------------------------------------------------------------------
  async comprobarSaludCompleta() {
    const attempt = () =>
      this.request(
        CONFIG.ENDPOINTS.HEALTH,
        { method: 'GET', cache: 'no-store' },
        CONFIG.TIMING.HEALTH_TIMEOUT_MS || 10000,
        { skipAuth: true }
      );

    let res = await attempt();
    if (!res.ok || res.data?.rds?.status !== 'online') {
      await new Promise((r) => setTimeout(r, 600));
      const retry = await attempt();
      if (retry.ok || res.status === 0) {
        res = retry;
      }
    }

    const apiOnline = res.ok && res.data?.api === 'online';
    const rdsData = res.data?.rds || null;
    const rdsOnline = Boolean(apiOnline && rdsData?.status === 'online');

    return {
      aws: {
        ok: apiOnline,
        status: res.status,
        latencyMs: res.latencyMs,
        error: apiOnline ? undefined : res.error || `HTTP ${res.status}`,
      },
      rds: {
        ok: rdsOnline,
        status: rdsOnline ? 200 : res.status,
        latencyMs: rdsData?.latency_ms ?? null,
        detail: rdsOnline
          ? `Disponible${Number.isFinite(rdsData?.latency_ms) ? ` · ${rdsData.latency_ms} ms` : ''}`
          : apiOnline
            ? 'No disponible'
            : 'Sin conexión API',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Control y Monitoreo (dinámico por vehicleId activo)
  // ---------------------------------------------------------------------------
  enviarMovimiento(idComando, opts = {}) {
    const vid = opts.vehicleId ?? this.vehicleId;
    const timeout =
      opts.timeoutMs ||
      (Number(idComando) === CONFIG.COMMANDS.DETENER ? 4000 : CONFIG.TIMING.MOVEMENT_TIMEOUT_MS);
    return this.post(
      CONFIG.ENDPOINTS.MOVIMIENTO(vid),
      { id_comando: Number(idComando) },
      { keepalive: opts.keepalive, timeoutMs: timeout }
    );
  }

  iniciarDemo(idDemoSeleccionada, vehicleId = this.vehicleId) {
    return this.post(CONFIG.ENDPOINTS.DEMO_INICIAR(vehicleId), {
      id_demo: parseInt(idDemoSeleccionada, 10),
    });
  }

  cancelarDemo(vehicleId = this.vehicleId) {
    return this.post(CONFIG.ENDPOINTS.CANCELAR_DEMO(vehicleId));
  }

  obtenerVehiculos(query = '') {
    return this.get(`${CONFIG.ENDPOINTS.VEHICULOS}${query}`);
  }

  obtenerVehiculo(vehicleId = this.vehicleId) {
    return this.get(CONFIG.ENDPOINTS.VEHICULO(vehicleId));
  }

  obtenerComandos(vehicleId = this.vehicleId) {
    return this.get(CONFIG.ENDPOINTS.COMANDOS(vehicleId));
  }

  obtenerDemos(vehicleId = this.vehicleId) {
    return this.get(CONFIG.ENDPOINTS.DEMOS(vehicleId));
  }

  obtenerEstado(vehicleId = this.vehicleId) {
    return this.get(CONFIG.ENDPOINTS.ESTADO(vehicleId));
  }

  obtenerHistorial(vehicleId = this.vehicleId) {
    return this.get(CONFIG.ENDPOINTS.HISTORIAL(vehicleId));
  }

  // ---------------------------------------------------------------------------
  // Catálogo público, Invitados, Tienda (capacidades, exhibición y soporte)
  // ---------------------------------------------------------------------------
  obtenerCatalogoPublicoModelos() {
    return this.get(CONFIG.ENDPOINTS.PUBLIC_MODELOS, { skipAuth: true });
  }

  obtenerCatalogoPublicoExhibicion() {
    return this.get(CONFIG.ENDPOINTS.PUBLIC_EXHIBICION, { skipAuth: true });
  }

  iniciarSesionInvitado(payload) {
    return this.post(CONFIG.ENDPOINTS.INVITADO_SESIONES, payload);
  }

  obtenerSesionInvitadoActual() {
    return this.get(CONFIG.ENDPOINTS.INVITADO_ACTUAL);
  }

  cerrarSesionInvitado() {
    return this.post(CONFIG.ENDPOINTS.INVITADO_CERRAR);
  }

  obtenerCapacidadesModelo(idModelo) {
    return this.get(CONFIG.ENDPOINTS.MODELO_CAPACIDADES(idModelo));
  }

  cambiarModoExhibicion(idVehiculo, habilitar, motivo = null) {
    return this.post(CONFIG.ENDPOINTS.VEHICULO_MODO_EXHIBICION(idVehiculo), {
      habilitar: Boolean(habilitar),
      motivo,
    });
  }

  listarSoporte(idVehiculo) {
    return this.get(CONFIG.ENDPOINTS.SOPORTE_LISTAR(idVehiculo));
  }

  otorgarSoporte(idVehiculo, payload) {
    return this.post(CONFIG.ENDPOINTS.SOPORTE_OTORGAR(idVehiculo), payload);
  }

  revocarSoporte(idAutorizacion) {
    return this.post(CONFIG.ENDPOINTS.SOPORTE_REVOCAR(idAutorizacion));
  }
}

export const api = new ApiService();
