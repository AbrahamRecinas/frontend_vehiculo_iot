# Grúa RC IoT · Frontend de Control

Aplicación web **Mobile First** (HTML5 semántico + CSS3 + Bootstrap 5 + Vanilla JS) dedicada al **control remoto** del vehículo grúa RC IoT.

## Fases del proyecto

| Fase | Módulo | Estado |
|---|---|---|
| **Control** | `index.html`, `assets/css/style.css`, `assets/js/{config,api,ws,joystick,ui,app}.js` | ✅ En desarrollo |
| Monitoreo | Panel de telemetría / estado del vehículo | ⬜ No iniciado |
| Administración | Gestión de vehículos / usuarios | ⬜ No iniciado |

> Este repositorio contiene **ÚNICAMENTE** la fase de Control. No incluye backend nuevo, ni tablas, ni procedimientos almacenados, ni módulo de Monitoreo/Administración.

## Especificación del Backend (AWS / FastAPI)

- **Base URL:** `https://grua-abraham.duckdns.org`
- **WSS:** `wss://grua-abraham.duckdns.org/ws/vehiculo/1`
- **Docs (Swagger):** `https://grua-abraham.duckdns.org/docs`
- **Vehículo:** `#1`

### Endpoints de acción

```http
POST /api/vehiculos/1/movimiento
Content-Type: application/json

{ "id_comando": 1 }
```

```http
POST /api/vehiculos/1/demo/cancelar
```

### Endpoints de consulta

```http
GET /api/vehiculos/1/comandos
GET /api/vehiculos/1/demos
GET /health        // (o /api/health según configuración)
```

### Eventos WebSocket esperados

```json
{ "id_comando": 1 }
```

```json
{ "evento": "FIN_DEMO", "timestamp": "2026-..." }
```

## Reglas de negocio implementadas (Control)

1. **Joystick circular táctil (Mobile First):**
   - Mapea direcciones a `POST /movimiento` con lógica **Toggle** de hardware.
   - Envía **una sola vez** el `POST` de dirección al iniciar el arrastre.
   - Al **soltar** el joystick: envía obligatoriamente `POST /movimiento { "id_comando": 12 }` (DETENER / paro general).
2. **Botones secundarios** (Pala `5/6`, Diagonales `7/8`, Auxiliares `9/10/13/14`).
3. **Botón gigante e inconfundible de DETENER** (`CMD 12`) en barra sticky inferior.
4. **Panel de conectividad** con tres estados:
   - **WebSocket WSS** (conexión / reconexión / estado).
   - **Servidor AWS** (comprobación vía `GET /docs`).
   - **Amazon RDS** (`Sin verificar` — sin endpoint dedicado).
5. **Footer responsivo:** «Desarrollado por Abraham Falcon Recinas · 2026».

## Seguridad y experiencia

- **CSP** estricta via `<meta http-equiv>` (compatible con GitHub Pages).
- Bootstrap 5.3.3 con **SRI** (Subresource Integrity) + CDN.
- JavaScript Modules (ES6) puro, sin frameworks.
- Fetch API + async/await. AbortController con timeouts.
- WebSocket con reconexión automática (retroceso exponencial + jitter).
- Fail-safe: si falla un movimiento o se pierde WSS durante un arrastre → frenado automático vía `CMD 12`.

## Despliegue en GitHub Pages

1. El repositorio debe estar configurado con GitHub Actions como origen de Pages.
2. El workflow en `.github/workflows/pages.yml` publica la rama `main`.
3. Las rutas relativas se usan para que funcione en el subpath del repositorio:
   - `./assets/css/style.css`
   - `./assets/js/app.js`
   - `./manifest.webmanifest`
   - `./assets/icons/favicon.svg`
4. **CORS:** el backend FastAPI ya debe permitir el origen `https://<usuario>.github.io`.

## Construcción / Verificación local

```bash
# Servir estáticamente con HTTPS (o usar un servidor local)
npx serve -s .
```

Para pruebas con HTTPS local:

```bash
npx http-server -S --cert ./cert.pem --key ./key.pem -p 8080
```

## Checklist de Pruebas Funcionales

- [ ] Joystick envía 1 POST al iniciar arrastre y 12 al soltar.
- [ ] Botón DETENER envía 12 aunque haya movimiento en curso.
- [ ] Demo: iniciar (`11`) → cancelar (`/demo/cancelar`).
- [ ] Evento `FIN_DEMO` limpia estado.
- [ ] Semáforos WSS / AWS / RDS se muestran correctamente.
- [ ] Reconexión automática tras caída de WSS.
