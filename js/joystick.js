/**
 * joystick.js
 * Controlador tactil circular Mobile First con soporte Pointer Events y teclado accesible.
 * Implementa la regla estricta de hardware Toggle:
 *  - 1 solo POST de direccion al iniciar el arrastre (sin rafagas ni repeticiones).
 *  - 1 POST obligatorio de comando 12 (DETENER) al soltar el joystick.
 *  - Zona muerta del 25% del radio: sin direccion activa se libera (CMD 12).
 *  - Control de cambio de estado: solo emite WSS si la direccion detectada difiere del ultimo CMD.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';

// Estado de cambio de comando del joystick: 12 = DETENER (liberado / sin movimiento)
let currentJoystickCmd = 12;

export class JoystickController {
  /**
   * @param {HTMLElement} trackEl - Contenedor circular del joystick
   * @param {HTMLElement} knobEl - Pomo movil central
   * @param {object} callbacks - { onDirection: (cmdId) => void, onRelease: () => void, onVisualChange: (info) => void, onLockChange: (controller) => void }
   */
  constructor(trackEl, knobEl, callbacks = {}) {
    this.track = trackEl;
    this.knob = knobEl;
    this.callbacks = callbacks;

    this.activePointerId = null;
    this.isDragging = false;
    this.latchedCommand = null; // Comando enclavado en el arrastre actual
    this.armedByKey = null;
    this.center = { x: 0, y: 0 };
    this.maxRadius = 70; // Se recalcula en pointerdown
    this.deadzoneRadius = 20; // Se recalcula en pointerdown (25% del radio)

    this.initEvents();
  }

  initEvents() {
    // Eventos de puntero unificados (touch, mouse, stylus)
    this.track.addEventListener('pointerdown', (e) => this.handlePointerDown(e), { passive: false });
    this.track.addEventListener('pointermove', (e) => this.handlePointerMove(e), { passive: false });
    this.track.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    this.track.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
    this.track.addEventListener('lostpointercapture', (e) => this.handlePointerUp(e));

    // Soporte accesible por teclado: global en modo mando cuando el foco no está en un control de formulario
    window.addEventListener('keydown', (e) => {
      if (this.shouldHandleKeyboardEvent(e)) this.handleKeyDown(e);
    });
    window.addEventListener('keyup', (e) => {
      if (this.armedByKey || this.shouldHandleKeyboardEvent(e)) this.handleKeyUp(e);
    });

    // Si la ventana o la pestaña pierden foco mientras hay movimiento activo, asegurar frenado
    const releaseOnFocusLoss = () => {
      if (this.isDragging || this.armedByKey || this.latchedCommand !== null) {
        this.forceRelease();
        if (this.callbacks.onRelease) this.callbacks.onRelease({ forcedStop: true });
      }
    };
    window.addEventListener('blur', releaseOnFocusLoss);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') releaseOnFocusLoss();
    });
  }

  shouldHandleKeyboardEvent(e) {
    if (!document.body.classList.contains('mando-control')) return false;
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    const target = e.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (target.isContentEditable || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        return false;
      }
      if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) {
        return false;
      }
    }
    return true;
  }

  recalculateBounds() {
    const rect = this.track.getBoundingClientRect();
    this.center = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    const knobRect = this.knob.getBoundingClientRect();
    const knobRadius = knobRect.width / 2 || 25;
    const trackRadius = rect.width / 2;

    this.maxRadius = Math.max(30, trackRadius - knobRadius - 6);
    this.deadzoneRadius = this.maxRadius * 0.25; // Zona muerta: 25% del radio
  }

  handlePointerDown(e) {
    if (this.activePointerId !== null) return; // Solo un puntero activo a la vez
    // FASE 4: exclusión mutua — si el D-Pad tiene el control, el joystick no responde
    if (window.activeController === 'dpad') return;
    e.preventDefault();

    this.activePointerId = e.pointerId;
    try {
      this.track.setPointerCapture(e.pointerId);
    } catch (_) {
      // Si la captura no es posible, el arrastre seguira con los eventos de movimiento
    }
    this.recalculateBounds();

    this.isDragging = true;
    this.latchedCommand = null;
    this.armedByKey = null;
    this.track.classList.add('dragging');

    // FASE 4: exclusión mutua — al tocar el joystick se activa este controlador
    if (this.callbacks.onLockChange) {
      this.callbacks.onLockChange('joystick');
    }

    this.processPointerPosition(e.clientX, e.clientY);
  }

  handlePointerMove(e) {
    if (!this.isDragging || e.pointerId !== this.activePointerId) return;
    e.preventDefault();
    this.processPointerPosition(e.clientX, e.clientY);
  }

  handlePointerUp(e) {
    if (e && e.pointerId !== undefined && e.pointerId !== this.activePointerId) return;
    if (!this.isDragging) return;

    if (this.activePointerId !== null) {
      try {
        this.track.releasePointerCapture(this.activePointerId);
      } catch (_) {}
    }

    const hadLatched = this.latchedCommand !== null;

    this.activePointerId = null;
    this.isDragging = false;
    this.latchedCommand = null;
    currentJoystickCmd = CONFIG.COMMANDS.DETENER; // 12 = DETENER
    this.track.classList.remove('dragging');

    // Regresar el pomo visualmente al centro
    this.resetKnob();

    // Feedback háptico al soltar
    if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(25); } catch (_) {}
    }

    // Al soltar el joystick, manda obligatoriamente el POST con el ID 12 (DETENER)
    if (this.callbacks.onRelease) {
      this.callbacks.onRelease({ hadMovement: hadLatched });
    }

    // FASE 4: limpiar exclusión mutua al liberar el control
    if (this.callbacks.onLockChange) {
      this.callbacks.onLockChange(null);
    }
  }

  processPointerPosition(clientX, clientY) {
    const rawDx = clientX - this.center.x;
    const rawDy = clientY - this.center.y;
    const distance = Math.hypot(rawDx, rawDy);

    // Zona muerta (25% del radio): si el toque esta dentro, no hay direccion activa
    // -> se libera el comando actual enviando el paro (CMD 12).
    if (distance < this.deadzoneRadius) {
      if (this.latchedCommand !== null) {
        this.latchedCommand = null;
        currentJoystickCmd = CONFIG.COMMANDS.DETENER;
        this.resetKnob();
        if (this.callbacks.onRelease) {
          this.callbacks.onRelease({ hadMovement: true });
        }
      }
      return;
    }

    // Limitar el recorrido visual del pomo al maximo permitido
    let visualX = rawDx;
    let visualY = rawDy;
    if (distance > this.maxRadius) {
      const angle = Math.atan2(rawDy, rawDx);
      visualX = Math.cos(angle) * this.maxRadius;
      visualY = Math.sin(angle) * this.maxRadius;
    }

    // Actualizar posicion grafica del pomo en pantalla
    this.knob.style.transform = `translate3d(${visualX}px, ${visualY}px, 0)`;

    const detectedSector = this.calculateSector(rawDx, rawDy);

    // Durante el arrastre: si la direccion cambia, enviar el nuevo POST inmediatamente
    if (detectedSector && distance >= this.deadzoneRadius) {
      // Anti-saturacion WSS: solo emitir si la nueva direccion difiere del ultimo CMD enviado
      if (currentJoystickCmd !== detectedSector) {
        currentJoystickCmd = detectedSector;
        this.latchedCommand = detectedSector;

        // Vibra corta al enganchar la direccion
        if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
          try { navigator.vibrate(15); } catch (_) {}
        }

        // Emitir el POST del nuevo movimiento sin esperar a soltar el puntero.
        // Si la petición falla, se libera el comando recordado para permitir reintento.
        if (this.callbacks.onDirection) {
          Promise.resolve(this.callbacks.onDirection(this.latchedCommand)).then((ok) => {
            if (ok === false && currentJoystickCmd === detectedSector) {
              currentJoystickCmd = CONFIG.COMMANDS.DETENER;
              this.latchedCommand = null;
            }
          });
        }
      }
    }

    // Notificar cambio visual (para guías N, S, E, W)
    if (this.callbacks.onVisualChange) {
      this.callbacks.onVisualChange({
        dx: visualX,
        dy: visualY,
        distance,
        latchedCommand: this.latchedCommand,
      });
    }
  }

  /**
   * Mapea el vector (dx, dy) a los 4 sectores exclusivos del joystick:
   *  - Arriba: Avanzar (1)
   *  - Abajo: Retroceder (2)
   *  - Derecha: Diagonal Derecha (7)
   *  - Izquierda: Diagonal Izquierda (8)
   */
  calculateSector(dx, dy) {
    // atan2 devuelve el angulo en radianes de -PI a +PI (0 apunta al eje X positivo/Derecha)
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    // Sectores simetricos de 90° con bisectrices en 45°, 135°, -135°, -45°
    if (angleDeg >= -135 && angleDeg < -45) {
      return CONFIG.COMMANDS.AVANZAR; // ID 1
    }
    if (angleDeg >= 45 && angleDeg < 135) {
      return CONFIG.COMMANDS.RETROCEDER; // ID 2
    }
    if (angleDeg >= -45 && angleDeg < 45) {
      return CONFIG.COMMANDS.DIAGONAL_DERECHA; // ID 7
    }
    if (angleDeg >= 135 || angleDeg < -135) {
      return CONFIG.COMMANDS.DIAGONAL_IZQUIERDA; // ID 8
    }
    return null;
  }

  resetKnob() {
    this.knob.style.transform = 'translate3d(0px, 0px, 0)';
    if (this.callbacks.onVisualChange) {
      this.callbacks.onVisualChange({
        dx: 0,
        dy: 0,
        distance: 0,
        latchedCommand: null,
      });
    }
  }

  /* ------------------------------------------------------------------------
     SOPORTE ACCESIBLE DE TECLADO
     ------------------------------------------------------------------------ */
  handleKeyDown(e) {
    // Ignorar repeticion automatica del sistema operativo para evitar rafagas de toggle
    if (e.repeat) return;

    // FASE 4: exclusión mutua — si el D-Pad tiene el control, el joystick no responde
    if (window.activeController === 'dpad') return;

    let targetCmd = null;
    let keyName = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        targetCmd = CONFIG.COMMANDS.AVANZAR;
        keyName = e.key;
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        targetCmd = CONFIG.COMMANDS.RETROCEDER;
        keyName = e.key;
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        targetCmd = CONFIG.COMMANDS.DIAGONAL_DERECHA;
        keyName = e.key;
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        targetCmd = CONFIG.COMMANDS.DIAGONAL_IZQUIERDA;
        keyName = e.key;
        break;
      case ' ':
      case 'Escape':
        e.preventDefault();
        this.forceRelease();
        if (this.callbacks.onRelease) this.callbacks.onRelease({ forcedStop: true });
        return;
      default:
        return;
    }

    if (targetCmd && !this.latchedCommand) {
      e.preventDefault();
      this.recalculateBounds();
      this.latchedCommand = targetCmd;
      currentJoystickCmd = targetCmd;
      this.armedByKey = keyName;
      this.track.classList.add('dragging');
      if (this.callbacks.onLockChange) {
        this.callbacks.onLockChange('joystick');
      }
      this.animateKnobDirection(targetCmd);

      if (this.callbacks.onDirection) {
        Promise.resolve(this.callbacks.onDirection(targetCmd)).then((ok) => {
          if (ok === false && currentJoystickCmd === targetCmd) {
            this.forceRelease();
          }
        });
      }
    }
  }

  handleKeyUp(e) {
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'W', 's', 'S', 'a', 'A', 'd', 'D'];
    if (keys.includes(e.key)) {
      e.preventDefault();
      // Solo liberar si la tecla que se suelta fue la que armo el movimiento
      if (this.armedByKey && this.armedByKey.toLowerCase() === e.key.toLowerCase()) {
        this.forceRelease();

        if (this.callbacks.onRelease) {
          this.callbacks.onRelease({ hadMovement: true });
        }
      }
    }
  }

  animateKnobDirection(cmdId) {
    const dist = this.maxRadius * 0.75;
    let x = 0;
    let y = 0;
    if (cmdId === CONFIG.COMMANDS.AVANZAR) y = -dist;
    if (cmdId === CONFIG.COMMANDS.RETROCEDER) y = dist;
    if (cmdId === CONFIG.COMMANDS.DIAGONAL_DERECHA) x = dist;
    if (cmdId === CONFIG.COMMANDS.DIAGONAL_IZQUIERDA) x = -dist;

    this.knob.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (this.callbacks.onVisualChange) {
      this.callbacks.onVisualChange({ dx: x, dy: y, distance: dist, latchedCommand: cmdId });
    }
  }

  /**
   * Fuerza el restablecimiento externo (ej. al pulsar DETENER)
   */
  forceRelease() {
    this.activePointerId = null;
    this.isDragging = false;
    this.latchedCommand = null;
    this.armedByKey = null;
    currentJoystickCmd = CONFIG.COMMANDS.DETENER; // 12 = DETENER
    this.track.classList.remove('dragging');
    this.resetKnob();
    if (this.callbacks.onLockChange) {
      this.callbacks.onLockChange(null);
    }
  }
}
