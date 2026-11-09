/**
 * ws.js
 * Gestor del canal WebSocket seguro (WSS) con telemetría en tiempo real.
 * Implementa reconexión automática con retroceso exponencial, jitter y despacho de eventos.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';

class WebSocketService {
  constructor() {
    this.url = CONFIG.WSS_URL;
    this.socket = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.isExplicitlyClosed = false;
    this.state = 'closed'; // 'connecting' | 'open' | 'closed' | 'error'
    this.lastMessageRaw = null;
  }

  /**
   * Suscribe un callback a un evento interno.
   * Eventos: 'statusChange', 'command_echo', 'fin_demo', 'message'
   */
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

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (err) {
          console.error(`[WS] Error en listener del evento '${event}':`, err);
        }
      }
    }
  }

  /**
   * Inicia la conexión con el endpoint WSS.
   */
  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isExplicitlyClosed = false;
    this.updateState('connecting', 'Conectando al canal de telemetría...');

    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        this.handleOpen();
      };

      this.socket.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.socket.onerror = (err) => {
        console.error("Detalle del Error WSS:", err);
        this.updateState('error', 'Error en canal WSS');
      };

      this.socket.onclose = (event) => {
        this.socket = null;
        if (!this.isExplicitlyClosed) {
          this.updateState('closed', `Canal cerrado (código ${event.code})`);
          this.scheduleReconnect();
        } else {
          this.updateState('closed', 'Desconectado manualmente');
        }
      };
    } catch (err) {
      this.updateState('error', err.message || 'Error al instanciar WebSocket');
      this.scheduleReconnect();
    }
  }

  /**
   * Cierra explícitamente la conexión y cancela reintentos.
   */
  disconnect() {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close(1000, 'Cierre ordenado por usuario');
      this.socket = null;
    }
    this.updateState('closed', 'Desconectado');
  }

  /**
   * Procesa mensajes de texto entrantes desde el backend.
   * Espera formatos JSON tales como:
   *  - {"id_comando": 1}
   *  - {"evento": "FIN_DEMO", "timestamp": "..."}
   */
  handleMessage(rawText) {
    this.lastMessageRaw = rawText;
    let payload = null;

    try {
      payload = JSON.parse(rawText);
    } catch (_) {
      // Si el backend envía texto plano
      this.emit('message', { raw: rawText });
      return;
    }

    this.emit('message', payload);

    if (payload && typeof payload === 'object') {
      // Evento de finalización de demo
      if (payload.evento === 'FIN_DEMO') {
        this.emit('fin_demo', payload);
      }

      // Eco de comando ejecutado
      if (typeof payload.id_comando === 'number') {
        this.emit('command_echo', payload.id_comando);
      }
    }
  }

  /**
   * Programa reconexión automática con retroceso exponencial y jitter.
   */
  scheduleReconnect() {
    if (this.isExplicitlyClosed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectAttempts += 1;
    const baseDelay = Math.min(
      CONFIG.TIMING.WS_INITIAL_RECONNECT_DELAY_MS * Math.pow(1.8, this.reconnectAttempts - 1),
      CONFIG.TIMING.WS_MAX_RECONNECT_DELAY_MS
    );
    // Aplicar jitter aleatorio para no saturar el servidor
    const jitter = baseDelay * CONFIG.TIMING.WS_RECONNECT_JITTER * (Math.random() * 2 - 1);
    const delay = Math.max(800, Math.round(baseDelay + jitter));

    this.updateState('connecting', `Reintentando en ${Math.round(delay / 1000)}s (intento ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  updateState(state, detail = '') {
    this.state = state;
    this.emit('statusChange', { state, detail, attempts: this.reconnectAttempts });
  }

  /**
   * Estado del socket y manejo de eventos de ciclo de vida.
   */
  handleOpen() {
    this.reconnectAttempts = 0;
    this.updateState('open', 'En línea · Operativo');
  }

  getState() {
    return this.state;
  }

  getMetrics() {
    return {
      state: this.state,
      attempts: this.reconnectAttempts,
      lastMessage: this.lastMessageRaw,
      readyState: this.socket ? this.socket.readyState : WebSocket.CLOSED,
    };
  }
}

export const wsService = new WebSocketService();
