# Quinayas Cafe - Llamado QR y Panel de Sala

Proyecto base para el sistema de llamado por QR con frontend mobile-first para la mesa y panel web interno para meseros con alarma continua.

## Que incluye

- Pantalla mobile-first para atencion de mesa
- Panel web para meseros en `/staff`
- Alarma continua en navegador hasta marcar la mesa como atendida
- Lectura de mesa desde la URL
- Boton `Llamar mesero`
- Cooldown local para evitar llamados repetidos
- Backend en Express
- Endpoint real `POST /api/calls`
- WhatsApp preparado como canal secundario opcional

## Estructura

- `index.html`: punto de entrada
- `src/main.js`: logica del front
- `src/staff.js`: logica del panel de meseros
- `src/styles.css`: estilos
- `server.js`: servidor Express y API
- `src/services/call-notifier.js`: adaptador de Twilio

## Instalacion

1. Instala dependencias:

```bash
npm install
```

2. Crea tu archivo de entorno:

```bash
cp .env.example .env
```

## Como probarlo

1. Inicia el servidor:

```bash
npm start
```

2. Abre en el navegador:

- `http://localhost:3000/`
- `http://localhost:3000/?mesa=7`
- `http://localhost:3000/mesa/7`
- `http://localhost:3000/staff`

## Despliegue gratis en Render

Este repo ya incluye [render.yaml](/Users/sebastian/dev/apps/Quinayas/render.yaml) para facilitar el despliegue en un subdominio `onrender.com`.

### Trabajo a realizar

1. Subir el proyecto a GitHub
2. Crear cuenta gratis en Render
3. En Render, elegir `New > Blueprint` o `New > Web Service`
4. Conectar el repositorio
5. Si usas `Blueprint`, Render leera `render.yaml`
6. Si lo haces manual, usar:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: `Free`
7. Esperar el primer deploy
8. Render entregara una URL tipo:
   - `https://quinayas-mesa-call.onrender.com`
9. Probar:
   - `/`
   - `/mesa/7`
   - `/staff`

### Notas importantes para pruebas

- El plan gratis de Render es adecuado para implementacion y validacion, no para operacion definitiva.
- Como este proyecto hoy guarda alertas en memoria, si el servicio reinicia se pierde la bitacora temporal.
- El panel de sala seguira funcionando bien para pruebas mientras el servicio este encendido.

## Flujo principal

El front intenta enviar un `POST` a `/api/calls` con este payload:

```json
{
  "tableId": "7",
  "token": null,
  "channel": "web",
  "requestedAt": "2026-05-02T23:00:00.000Z"
}
```

Respuesta esperada:

```json
{
  "ok": true,
  "message": "Mesa 7 registrada en el panel interno.",
  "callId": "call_123",
  "alertId": "alert_123"
}
```

La atencion del equipo ocurre desde:

- `GET /api/staff/alerts`
- `POST /api/staff/alerts/:alertId/acknowledge`
- `GET /staff`

## WhatsApp como plan B

Si luego quieres activar el reenvio adicional por WhatsApp:

1. Configura `.env`
2. Pon:

```env
ENABLE_WHATSAPP_FALLBACK=true
USE_TWILIO_DEMO=false
```

3. Completa:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_WHATSAPP_FROM`
   - `TWILIO_WHATSAPP_TO`
4. Opcional y recomendado para produccion:
   - `TWILIO_CONTENT_SID`
   - `TWILIO_MESSAGING_SERVICE_SID`
   - `TWILIO_STATUS_CALLBACK_URL`

## Configuracion real de Twilio

### Sandbox de WhatsApp

1. Entra a `Twilio Console > Messaging > Try it out > Send a WhatsApp message`
2. Activa el Sandbox
3. Desde el numero que recibira las alertas, envia el codigo `join ...` al numero del Sandbox
4. Configura `.env` con:

```env
USE_TWILIO_DEMO=false
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
TWILIO_WHATSAPP_TO=whatsapp:+57XXXXXXXXXX
```

Nota: el Sandbox solo sirve para pruebas y solo puede escribir a numeros unidos a ese Sandbox.

### Produccion con plantilla

Twilio y WhatsApp recomiendan usar plantillas aprobadas para mensajes fuera de la ventana de servicio de 24 horas. Para este caso, esa es la opcion mas segura.

1. Registra tu WhatsApp sender en Twilio
2. Crea una plantilla en `Messaging > Content Template Builder`
3. Espera la aprobacion de WhatsApp
4. Copia el `Content SID` al `.env`
5. Si usas Messaging Service, agrega `TWILIO_MESSAGING_SERVICE_SID`

Plantilla sugerida:

```text
{{3}}: solicitud de atencion
Mesa: {{1}}
Hora: {{2}}
Accion: acercarse a la mesa
```

Variables que este proyecto envia:

- `{{1}}`: mesa
- `{{2}}`: hora
- `{{3}}`: nombre del cafe

### Webhooks

Si publicas tu servidor con HTTPS, puedes configurar estos endpoints:

- Inbound WhatsApp webhook: `/webhooks/twilio/whatsapp`
- Status callback: `/webhooks/twilio/status`

Para revisar lo recibido localmente:

- `GET /api/debug/twilio`

## Siguientes pasos sugeridos

1. Generar tokens seguros por mesa para el QR
2. Persistir llamados en base de datos
3. Reemplazar polling por WebSocket o Server-Sent Events
4. Registrar el numero productivo de WhatsApp en Twilio si activas el plan B
