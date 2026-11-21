/**
 * auth.js
 * Gestión real de autenticación JWT (login, refresh, logout y sesión de invitado).
 * Reemplaza por completo el candado visual previo de sessionStorage.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';

const STORAGE_KEY = 'iot_jwt_session_v43';

class AuthService {
  constructor() {
    this.session = this._loadFromStorage();
    this.listeners = new Set();
    this._refreshPromise = null;
  }

  _loadFromStorage() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.accessToken === 'string' && parsed.usuario?.rol) {
        return parsed;
      }
    } catch (_) {
      // storage corrupto o no disponible
    }
    return null;
  }

  _saveToStorage() {
    try {
      if (!this.session) {
        sessionStorage.removeItem(STORAGE_KEY);
      } else {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
      }
    } catch (_) {
      // continuar solo en memoria
    }
  }

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notify(reason = 'change') {
    for (const cb of this.listeners) {
      try {
        cb(this.session, reason);
      } catch (err) {
        console.error('[AUTH] Error en listener:', err);
      }
    }
  }

  isAuthenticated() {
    return Boolean(this.session?.accessToken && this.session?.usuario?.rol);
  }

  getAccessToken() {
    return this.session?.accessToken || null;
  }

  getRefreshToken() {
    return this.session?.refreshToken || null;
  }

  getUser() {
    return this.session?.usuario || null;
  }

  getRole() {
    return this.session?.usuario?.rol || null;
  }

  getGuestSession() {
    return this.session?.sesionInvitado || null;
  }

  setSession({ accessToken, refreshToken = null, usuario, sesionInvitado = null }, reason = 'login') {
    this.session = {
      accessToken,
      refreshToken,
      usuario,
      sesionInvitado,
    };
    this._saveToStorage();
    this._notify(reason);
  }

  clearSession(reason = 'logout') {
    const hadSession = Boolean(this.session);
    this.session = null;
    this._saveToStorage();
    if (hadSession || reason === 'expired') {
      this._notify(reason);
    }
  }

  /**
   * Inicia sesión real contra POST /api/auth/login (bcrypt + JWT).
   */
  async login(correo, password) {
    const res = await this._rawPost(CONFIG.ENDPOINTS.AUTH_LOGIN, { correo, password });
    if (!res.ok) {
      return res;
    }

    const data = res.data || {};
    this.setSession(
      {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || null,
        usuario: data.usuario,
        sesionInvitado: null,
      },
      'login'
    );
    return res;
  }

  /**
   * Renueva el access_token usando el refresh_token almacenado.
   * Deduplica llamadas concurrentes para evitar múltiples refresh simultáneos.
   */
  async refresh() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return false;

    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this._refreshPromise = (async () => {
      const res = await this._rawPost(CONFIG.ENDPOINTS.AUTH_REFRESH, {
        refresh_token: refreshToken,
      });
      if (!res.ok || !res.data?.access_token) {
        return false;
      }
      if (this.session) {
        this.session = {
          ...this.session,
          accessToken: res.data.access_token,
        };
        this._saveToStorage();
        this._notify('refresh');
      }
      return true;
    })();

    try {
      return await this._refreshPromise;
    } finally {
      this._refreshPromise = null;
    }
  }

  /**
   * Valida la sesión almacenada contra GET /api/auth/me (y RDS/tokens_revocados).
   */
  async verifySession() {
    if (!this.isAuthenticated()) return false;

    let res = await this._fetchMe();
    if (!res.ok && res.status === 401 && this.getRefreshToken()) {
      const refreshed = await this.refresh();
      if (refreshed) {
        res = await this._fetchMe();
      }
    }

    if (!res.ok || !res.data?.rol) {
      this.clearSession('expired');
      return false;
    }

    this.session = {
      ...this.session,
      usuario: {
        id_usuario: res.data.id_usuario,
        nombre: res.data.nombre,
        correo: res.data.correo,
        rol: res.data.rol,
        activo: res.data.activo,
      },
      sesionInvitado: res.data.sesion_invitado || this.session.sesionInvitado || null,
    };
    this._saveToStorage();
    return true;
  }

  /**
   * Cierra sesión revocando access y refresh tokens en backend (`tokens_revocados`).
   */
  async logout() {
    const accessToken = this.getAccessToken();
    const refreshToken = this.getRefreshToken();
    const rol = this.getRole();

    try {
      if (accessToken) {
        const endpoint =
          rol === 'INVITADO' ? CONFIG.ENDPOINTS.INVITADO_CERRAR : CONFIG.ENDPOINTS.AUTH_LOGOUT;
        const body =
          rol === 'INVITADO'
            ? undefined
            : JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {});
        await fetch(`${CONFIG.BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          ...(body ? { body } : {}),
        });
      }
    } catch (_) {
      // Incluso sin red, limpiar estado local
    } finally {
      this.clearSession('logout');
    }
  }

  async _fetchMe() {
    const token = this.getAccessToken();
    if (!token) return { ok: false, status: 401, data: null };
    try {
      const response = await fetch(`${CONFIG.BASE_URL}${CONFIG.ENDPOINTS.AUTH_ME}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: null, error: err.message };
    }
  }

  async _rawPost(endpoint, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.TIMING.REST_TIMEOUT_MS);
    try {
      const response = await fetch(`${CONFIG.BASE_URL}${endpoint}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          typeof data?.detail === 'string'
            ? data.detail
            : `Error HTTP ${response.status}`;
        return { ok: false, status: response.status, data, error: detail };
      }
      return { ok: true, status: response.status, data };
    } catch (err) {
      const msg =
        err.name === 'AbortError'
          ? 'Tiempo de espera agotado al contactar el servidor.'
          : 'No fue posible conectar con el servidor API.';
      return { ok: false, status: 0, data: null, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const auth = new AuthService();
