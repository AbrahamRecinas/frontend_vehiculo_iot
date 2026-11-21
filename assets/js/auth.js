/**
 * auth.js
 * Gestión real de autenticación JWT (login, refresh, logout y sesión de invitado).
 * Persiste sesiones de ADMIN/USUARIO en localStorage (sobreviven F5 y recargas)
 * y sesiones temporales de INVITADO en sessionStorage.
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

  _parseStored(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const accessToken = parsed?.accessToken || parsed?.access_token || null;
      const refreshToken = parsed?.refreshToken || parsed?.refresh_token || null;
      const usuario = parsed?.usuario || null;
      const sesionInvitado = parsed?.sesionInvitado || parsed?.sesion_invitado || null;
      if (typeof accessToken === 'string' && accessToken.length > 10 && usuario?.rol) {
        return { accessToken, refreshToken, usuario, sesionInvitado };
      }
    } catch (_) {
      // storage corrupto
    }
    return null;
  }

  _loadFromStorage() {
    try {
      const fromSession = this._parseStored(sessionStorage.getItem(STORAGE_KEY));
      if (fromSession) return fromSession;
    } catch (_) {}
    try {
      const fromLocal = this._parseStored(localStorage.getItem(STORAGE_KEY));
      if (fromLocal) return fromLocal;
    } catch (_) {}
    return null;
  }

  _saveToStorage() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}

    if (!this.session) return;

    const serialized = JSON.stringify(this.session);
    const isGuest = this.session.usuario?.rol === 'INVITADO';
    try {
      if (isGuest) {
        sessionStorage.setItem(STORAGE_KEY, serialized);
      } else {
        localStorage.setItem(STORAGE_KEY, serialized);
      }
    } catch (_) {
      try {
        sessionStorage.setItem(STORAGE_KEY, serialized);
      } catch (__) {
        // continuar solo en memoria
      }
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

  clearSession(reason = 'logout', { notify = true } = {}) {
    this.session = null;
    this._saveToStorage();
    if (notify) {
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
  async refresh({ silent = false } = {}) {
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
        if (!silent) {
          this._notify('refresh');
        }
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
   * Recupera tokens almacenados y los valida contra GET /api/auth/me.
   * Si el access_token expiró (401), intenta /api/auth/refresh antes de expulsar.
   * Nunca destruye una sesión válida por un error transitorio de red/timeout.
   */
  async verifySession() {
    this.session = this._loadFromStorage();
    if (!this.isAuthenticated()) {
      return { valid: false, reason: 'none' };
    }

    let res = await this._fetchMe();
    if (!res.ok && res.status === 401 && this.getRefreshToken()) {
      const refreshed = await this.refresh({ silent: true });
      if (refreshed) {
        res = await this._fetchMe();
      }
    }

    if (res.ok && res.data?.rol) {
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
      return { valid: true, reason: 'ok' };
    }

    if (res.status === 401 || res.status === 403) {
      this.clearSession('expired', { notify: false });
      return { valid: false, reason: 'expired' };
    }

    // Error transitorio (status 0 o 5xx): conservar sesión local para no expulsar por un microcorte
    return { valid: true, reason: 'offline_fallback' };
  }

  /**
   * Cierra sesión revocando access y refresh tokens en backend (`tokens_revocados`).
   * Siempre limpia storage local y notifica en `finally`.
   */
  async logout() {
    const accessToken = this.getAccessToken();
    const refreshToken = this.getRefreshToken();
    const rol = this.getRole();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    try {
      if (accessToken) {
        const isGuest = rol === 'INVITADO';
        const endpoint = isGuest ? CONFIG.ENDPOINTS.INVITADO_CERRAR : CONFIG.ENDPOINTS.AUTH_LOGOUT;
        const headers = {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        };
        const fetchOpts = {
          method: 'POST',
          signal: controller.signal,
          headers,
        };
        if (!isGuest) {
          headers['Content-Type'] = 'application/json';
          fetchOpts.body = JSON.stringify(
            refreshToken ? { refresh_token: refreshToken } : { refresh_token: null }
          );
        }
        await fetch(`${CONFIG.BASE_URL}${endpoint}`, fetchOpts);
      }
    } catch (_) {
      // Aunque falle la red o venza el timeout, siempre se limpia localmente en finally
    } finally {
      clearTimeout(timer);
      this.clearSession('logout');
    }
  }

  async _fetchMe() {
    const token = this.getAccessToken();
    if (!token) return { ok: false, status: 401, data: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${CONFIG.BASE_URL}${CONFIG.ENDPOINTS.AUTH_ME}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: null, error: err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  async _rawPost(endpoint, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.TIMING.REST_TIMEOUT_MS);
    try {
      const response = await fetch(`${CONFIG.BASE_URL}${endpoint}`, {
        method: 'POST',
        cache: 'no-store',
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
