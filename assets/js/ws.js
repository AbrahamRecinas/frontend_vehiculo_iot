/**
 * ws.js
 * Gestor del canal WebSocket seguro (WSS) con autenticación JWT por unidad.
 * Garantiza una única conexión activa por cliente (sin sockets duplicados al cambiar de vista).
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';
import { auth } from './auth.js';

const NO_RECONNECT_CODES = new Set([1000, 1008, 4401, 4403, 4404]);

class WebSocketService {
  constructor() {
    this.vehicleId = null;
    this.activeToken = null;
    this.displayUrl = CONFIG.buildDisplayWssUrl(CONFIG.VEHICLE_ID);
    this.socket = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.isExplicitlyClosed = true;
    this.state = 'closed'; // 'connecting' | 'open' | 'closed' | 'error'
    this.lastMessageRaw = null;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, ...args) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(...args);
        } catch (err) {
          console.error(`[WS] Error en listener '${event}':`, err);
        }
      }
    }
  }

  /**
   * Conecta (o reutiliza) el canal WSS para la unidad y token actual.
   * Si ya existe una conexión abierta/conectando al mismo vehículo y token, no la duplica.
   */
  connect(vehicleId = this.vehicleId ?? CONFIG.VEHICLE_ID) {
    const token = auth.getAccessToken();
    const targetId = Number(vehicleId);

    if (!token || !Number.isInteger(targetId) || targetId <= 0) {
      this.disconnect('En espera de sesión');
      return;
    }

    const sameTarget = this.vehicleId === targetId && this.activeToken === token;
    if (
      sameTarget &&
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    // Si había otro socket previo (otra unidad o token renovado), cerrarlo limpiamente
    if (this.socket) {
      this._closeCurrentSocket('Cambio de unidad o token');
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.vehicleId = targetId;
    this.activeToken = token;
    this.displayUrl = CONFIG.buildDisplayWssUrl(targetId);
    this.isExplicitlyClosed = false;
    this.updateState('connecting', `Conectando a unidad #${targetId}...`);

    try {
      const wsUrl = CONFIG.buildWssUrl(targetId, token);
      const sock = new WebSocket(wsUrl);
      this.socket = sock;

      sock.onopen = () => {
        if (this.socket !== sock) return;
        this.handleOpen();
      };

      sock.onmessage = (event) => {
        if (this.socket !== sock) return;
        this.handleMessage(event.data);
      };

      sock.onerror = () => {
        if (this.socket !== sock) return;
        this.updateState('error', 'Error en canal WSS');
      };

      sock.onclose = (event) => {
        if (this.socket !== sock) return;
        this.socket = null;

        if (this.isExplicitlyClosed) {
          this.updateState('closed', 'Desconectado');
          return;
        }

        if (NO_RECONNECT_CODES.has(event.code)) {
          const reason = event.reason || `Acceso WSS cerrado (${event.code})`;
          this.updateState('closed', reason);
          this.emit('authError', { code: event.code, reason, vehicleId: this.vehicleId });
          return;
        }

        this.updateState('closed', `Canal cerrado (código ${event.code})`);
        this.scheduleReconnect();
      };
    } catch (err) {
      this.updateState('error', err.message || 'Error al instanciar WebSocket');
      this.scheduleReconnect();
    }
  }

  _closeCurrentSocket(reason = 'Reemplazado') {
    const old = this.socket;
    this.socket = null;
    if (!old) return;
    old.onopen = null;
    old.onmessage = null;
    old.onerror = null;
    old.onclose = null;
    try {
      old.close(1000, reason);
    } catch (_) {
      // noop
    }
  }

  disconnect(detail = 'Desconectado') {
    this.isExplicitlyClosed = true;
    this.activeToken = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._closeCurrentSocket(detail);
    this.updateState('closed', detail);
  }

  handleMessage(rawText) {
    this.lastMessageRaw = rawText;
    let payload = null;

    try {
      payload = JSON.parse(rawText);
    } catch (_) {
      this.emit('message', { raw: rawText });
      return;
    }

    this.emit('message', payload);

    if (payload && typeof payload === 'object') {
      const evento = String(
        payload.evento || payload.tipo || payload.event || payload.type || ''
      ).toUpperCase();

      if (evento === 'ESTADO_INICIAL') {
        this.emit('estado_inicial', payload);
      }

      if (evento === 'ESTADO_DISPOSITIVO') {
        this.emit('estado_dispositivo', payload);
      }

      if (evento === 'FIN_DEMO' || evento === 'DEMO_FIN' || evento === 'DEMO_CANCELADA') {
        this.emit('fin_demo', payload);
      }

      if (evento === 'MOVIMIENTO_INDIVIDUAL') {
        this.emit('movimiento_individual', payload);
      }

      if (evento === 'MOVIMIENTO_DEMO' || evento === 'DEMO_MOVIMIENTO') {
        this.emit('movimiento_demo', payload);
      }

      if (evento === 'SESION_INVITADO_EXPIRADA' || evento === 'SESION_INVITADO_ESTADO') {
        this.emit('sesion_invitado', payload);
      }

      // Contrato congelado: priorizar codigo_fisico / codigo para feedback físico
      const rawCmd = payload.codigo_fisico ?? payload.codigo ?? payload.id_comando;
      if (rawCmd !== undefined && rawCmd !== null && rawCmd !== '') {
        const codigoFisico = Number(rawCmd);
        if (Number.isInteger(codigoFisico)) {
          this.emit('command_echo', codigoFisico, payload);
        }
      }
    }
  }

  scheduleReconnect() {
    if (this.isExplicitlyClosed || !auth.isAuthenticated()) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectAttempts += 1;
    const baseDelay = Math.min(
      CONFIG.TIMING.WS_INITIAL_RECONNECT_DELAY_MS * Math.pow(1.8, this.reconnectAttempts - 1),
      CONFIG.TIMING.WS_MAX_RECONNECT_DELAY_MS
    );
    const jitter = baseDelay * CONFIG.TIMING.WS_RECONNECT_JITTER * (Math.random() * 2 - 1);
    const delay = Math.max(800, Math.round(baseDelay + jitter));

    this.updateState(
      'connecting',
      `Reintentando en ${Math.round(delay / 1000)}s (intento ${this.reconnectAttempts})...`
    );

    this.reconnectTimer = setTimeout(() => {
      if (!this.isExplicitlyClosed && this.vehicleId && auth.isAuthenticated()) {
        this.connect(this.vehicleId);
      }
    }, delay);
  }

  updateState(state, detail = '') {
    this.state = state;
    this.emit('statusChange', { state, detail, attempts: this.reconnectAttempts });
  }

  handleOpen() {
    this.reconnectAttempts = 0;
    this.updateState('open', `En línea · Unidad #${this.vehicleId}`);
  }

  getState() {
    return this.state;
  }

  getMetrics() {
    return {
      state: this.state,
      attempts: this.reconnectAttempts,
      lastMessage: this.lastMessageRaw,
      wssUrl: this.displayUrl,
      readyState: this.socket ? this.socket.readyState : WebSocket.CLOSED,
    };
  }
}

export const wsService = new WebSocketService();
