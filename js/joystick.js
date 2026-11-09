/**
 * joystick.js
 * Controlador táctil circular Mobile First con soporte Pointer Events y teclado accesible.
 * Implementa la regla estricta de hardware Toggle:
 *  - 1 solo POST de dirección al iniciar el arrastre (sin ráfagas ni repeticiones).
 *  - 1 POST obligatorio de comando 12 (DETENER) al soltar el joystick.
 * Desarrollado por Abraham Falcon Recinas · 2026
 */

import { CONFIG } from './config.js';

export class JoystickController {
  /**
   * @param {HTMLElement} trackEl - Contenedor circular del joystick
   * @param {HTMLElement} knobEl - Pomo móvil central
   * @param {object} callbacks - { onDirection: (cmdId) => void, onRelease: () => void, onVisualChange: (info) => void }
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
    this.deadzoneRadius = 20;

    this.initEvents();
  }

  initEvents() {
    // Eventos de puntero unificados (touch, mouse, stylus)
    this.track.addEventListener('pointerdown', (e) => this.handlePointerDown(e), { passive: false });
    this.track.addEventListener('pointermove', (e) => this.handlePointerMove(e), { passive: false });
    this.track.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    this.track.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
    this.track.addEventListener('lostpointercapture', (e) => this.handlePointerUp(e));

    // Soporte accesible por teclado en el elemento joystick
    this.track.addEventListener('keydown', (e) => this.handleKeyDown(e));
    this.track.addEventListener('keyup', (e) => this.handleKeyUp(e));

    // Si la ventana pierde foco mientras se arrastra, asegurar frenado
    window.addEventListener('blur', () => {
      if (this.isDragging) {
        this.resetKnob();
        if (this.callbacks.onRelease) this.callbacks.onRelease();
      }
    });
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
    this.deadzoneRadius = this.maxRadius * 0.28; // 28% de zona muerta
  }

  handlePointerDown(e) {
    if (this.activePointerId !== null) return; // Solo un puntero activo a la vez
    e.preventDefault();

    this.activePointerId = e.pointerId;
    try {
      this.track.setPointerCapture(e.pointerId);
    } catch (_) {
      // Si la captura no es posible, el arrastre seguirá con los eventos de movimiento
    }
    this.recalculateBounds();

    this.isDragging = true;
    this.latchedCommand = null;
    this.armedByKey = null;
    this.track.classList.add('dragging');

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
  }

  processPointerPosition(clientX, clientY) {
    const rawDx = clientX - this.center.x;
    const rawDy = clientY - this.center.y;
    const distance = Math.hypot(rawDx, rawDy);

    // Limitar el recorrido visual del pomo al radio máximo permitido
    let visualX = rawDx;
    let visualY = rawDy;
    if (distance > this.maxRadius) {
      const angle = Math.atan2(rawDy, rawDx);
      visualX = Math.cos(angle) * this.maxRadius;
      visualY = Math.sin(angle) * this.maxRadius;
    }

    // Actualizar posición gráfica del pomo en pantalla
    this.knob.style.transform = `translate3d(${visualX}px, ${visualY}px, 0)`;

    const detectedSector = this.calculateSector(rawDx, rawDy);

    // Durante el arrastre: si la dirección cambia, enviar el nuevo POST inmediatamente
    if (detectedSector && distance >= this.deadzoneRadius) {
      if (!this.latchedCommand || detectedSector !== this.latchedCommand) {
        this.latchedCommand = detectedSector;

        // Vibración corta al enganchar la dirección
        if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
          try { navigator.vibrate(15); } catch (_) {}
        }

        // Emitir el POST del nuevo movimiento sin esperar a soltar el puntero
        if (this.callbacks.onDirection) {
          this.callbacks.onDirection(this.latchedCommand);
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
   * Mapea el vector (dx, dy) a los 4 sectores cardinales exclusivos del joystick:
   *  - Arriba: Avanzar (1)
   *  - Abajo: Retroceder (2)
   *  - Derecha: Girar Derecha (3)
   *  - Izquierda: Girar Izquierda (4)
   */
  calculateSector(dx, dy) {
    // atan2 devuelve el ángulo en radianes de -PI a +PI (0 apunta al eje X positivo/Derecha)
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    // Sectores simétricos de 90° con bisectrices en 45°, 135°, -135°, -45°
    if (angleDeg >= -135 && angleDeg < -45) {
      return CONFIG.COMMANDS.AVANZAR; // ID 1
    }
    if (angleDeg >= 45 && angleDeg < 135) {
      return CONFIG.COMMANDS.RETROCEDER; // ID 2
    }
    if (angleDeg >= -45 && angleDeg < 45) {
      return CONFIG.COMMANDS.GIRAR_DERECHA; // ID 3
    }
    if (angleDeg >= 135 || angleDeg < -135) {
      return CONFIG.COMMANDS.GIRAR_IZQUIERDA; // ID 4
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
    // Ignorar repetición automática del sistema operativo para evitar ráfagas de toggle
    if (e.repeat) return;

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
        targetCmd = CONFIG.COMMANDS.GIRAR_DERECHA;
        keyName = e.key;
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        targetCmd = CONFIG.COMMANDS.GIRAR_IZQUIERDA;
        keyName = e.key;
        break;
      case ' ':
      case 'Escape':
        e.preventDefault();
        if (this.callbacks.onRelease) this.callbacks.onRelease({ forcedStop: true });
        return;
      default:
        return;
    }

    if (targetCmd && !this.latchedCommand) {
      e.preventDefault();
      this.latchedCommand = targetCmd;
      this.armedByKey = keyName;
      this.animateKnobDirection(targetCmd);

      if (this.callbacks.onDirection) {
        this.callbacks.onDirection(targetCmd);
      }
    }
  }

  handleKeyUp(e) {
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'W', 's', 'S', 'a', 'A', 'd', 'D'];
    if (keys.includes(e.key)) {
      e.preventDefault();
      // Solo liberar si la tecla que se suelta fue la que armó el movimiento
      if (this.armedByKey === e.key) {
        this.latchedCommand = null;
        this.armedByKey = null;
        this.resetKnob();

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
    if (cmdId === CONFIG.COMMANDS.GIRAR_DERECHA) x = dist;
    if (cmdId === CONFIG.COMMANDS.GIRAR_IZQUIERDA) x = -dist;

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
    this.track.classList.remove('dragging');
    this.resetKnob();
  }
}
