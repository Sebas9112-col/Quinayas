require("dotenv").config();

const express = require("express");
const path = require("node:path");
const { createCallNotifier } = require("./src/services/call-notifier");

const app = express();
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const TABLE_CALL_COOLDOWN_SECONDS = Number(
  process.env.TABLE_CALL_COOLDOWN_SECONDS || 45
);
const ENABLE_WHATSAPP_FALLBACK =
  process.env.ENABLE_WHATSAPP_FALLBACK === "true";

const notifier = createCallNotifier({
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  cafeName: process.env.CAFE_NAME || "Quinayas Cafe",
  contentSid: process.env.TWILIO_CONTENT_SID,
  from: process.env.TWILIO_WHATSAPP_FROM,
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL,
  to: process.env.TWILIO_WHATSAPP_TO,
  useDemo: process.env.USE_TWILIO_DEMO !== "false",
});

const lastCallsByTable = new Map();
const pendingAlerts = [];
const resolvedAlerts = [];
const inboundMessages = [];
const statusEvents = [];

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use("/src", express.static(path.join(ROOT, "src")));

app.get("/api/status", (_request, response) => {
  response.json({
    ok: true,
    service: "quinayas-mesa-call",
    channels: {
      internalDesk: {
        enabled: true,
        pendingCount: pendingAlerts.length,
      },
      whatsappFallback: {
        enabled: ENABLE_WHATSAPP_FALLBACK,
        ...notifier.getStatus(),
      },
    },
  });
});

app.get("/api/staff/alerts", (_request, response) => {
  response.json({
    ok: true,
    pendingAlerts,
    recentAlerts: resolvedAlerts.slice(0, 12),
    serverTime: new Date().toISOString(),
  });
});

app.get("/api/tables/:tableId/status", (request, response) => {
  const tableId = sanitizeTableId(request.params.tableId);

  if (!tableId) {
    response.status(400).json({
      ok: false,
      message: "Mesa invalida.",
    });
    return;
  }

  const pendingAlert = pendingAlerts.find((alert) => alert.tableId === tableId);
  const latestAssignment = resolvedAlerts.find((alert) => alert.tableId === tableId);

  response.json({
    ok: true,
    latestAssignment: latestAssignment || null,
    pendingAlert: pendingAlert || null,
  });
});

app.post("/api/staff/alerts/:alertId/acknowledge", (request, response) => {
  const alertIndex = pendingAlerts.findIndex(
    (alert) => alert.id === request.params.alertId
  );

  if (alertIndex === -1) {
    response.status(404).json({
      ok: false,
      message: "La alerta ya no esta disponible.",
    });
    return;
  }

  const [alert] = pendingAlerts.splice(alertIndex, 1);
  const handledBy = sanitizeHandledBy(request.body?.handledBy);
  const resolvedAlert = {
    ...alert,
    acknowledgedAt: new Date().toISOString(),
    handledBy,
    status: "acknowledged",
  };

  resolvedAlerts.unshift(resolvedAlert);
  resolvedAlerts.splice(50);

  response.json({
    ok: true,
    alert: resolvedAlert,
    message: `Mesa ${alert.tableId} marcada como atendida.`,
  });
});

app.post("/api/calls", async (request, response) => {
  const requestedAt = request.body?.requestedAt || new Date().toISOString();
  const requestType = sanitizeRequestType(request.body?.requestType);
  const tableId = sanitizeTableId(request.body?.tableId);

  if (!tableId) {
    response.status(400).json({
      ok: false,
      message: "La mesa es obligatoria para registrar el llamado.",
    });
    return;
  }

  const existingPendingIndex = pendingAlerts.findIndex(
    (alert) => alert.tableId === tableId
  );
  const lastCall = lastCallsByTable.get(tableId);

  if (existingPendingIndex !== -1) {
    const [existingAlert] = pendingAlerts.splice(existingPendingIndex, 1);
    const updatedAlert = {
      ...existingAlert,
      callCount: (existingAlert.callCount || 1) + 1,
      lastRequestedAt: requestedAt,
      requestedAt,
      requestType,
    };

    pendingAlerts.unshift(updatedAlert);
    lastCallsByTable.set(tableId, {
      requestedAt,
      callId: updatedAlert.callId,
    });

    response.json({
      ok: true,
      alertId: updatedAlert.id,
      callId: updatedAlert.callId,
      callCount: updatedAlert.callCount,
      channels: {
        internalDesk: true,
        whatsappFallback: false,
      },
      message: `Mesa ${tableId} actualizada. Lleva ${updatedAlert.callCount} llamados.`,
      requestedAt,
    });
    return;
  }

  if (lastCall && isCoolingDown(lastCall.requestedAt)) {
    response.status(429).json({
      ok: false,
      message: `La mesa ${tableId} ya tiene un llamado reciente.`,
      retryAfterSeconds: getRetryAfterSeconds(lastCall.requestedAt),
    });
    return;
  }

  const callId = `call-${Date.now()}`;
  const alert = createPendingAlert({
    callId,
    requestedAt,
    requestType,
    tableId,
  });

  pendingAlerts.unshift(alert);
  lastCallsByTable.set(tableId, {
    requestedAt,
    callId,
  });

  const whatsappResult = await sendWhatsAppFallback({
    requestedAt,
    tableId,
  });

  response.json({
    ok: true,
    alertId: alert.id,
    callId,
    channels: {
      internalDesk: true,
      whatsappFallback: whatsappResult.sent,
    },
    message: buildSuccessMessage({
      requestType,
      tableId,
      whatsappSent: whatsappResult.sent,
    }),
    requestedAt,
  });
});

app.post("/webhooks/twilio/whatsapp", (request, response) => {
  const event = {
    body: request.body?.Body || "",
    from: request.body?.From || null,
    messageSid: request.body?.MessageSid || null,
    receivedAt: new Date().toISOString(),
    to: request.body?.To || null,
  };

  inboundMessages.unshift(event);
  inboundMessages.splice(20);

  console.log("Webhook WhatsApp recibido:", event);

  response.type("text/xml");
  response.send("<Response></Response>");
});

app.post("/webhooks/twilio/status", (request, response) => {
  const event = {
    errorCode: request.body?.ErrorCode || null,
    errorMessage: request.body?.ErrorMessage || null,
    messageSid: request.body?.MessageSid || null,
    messageStatus: request.body?.MessageStatus || null,
    receivedAt: new Date().toISOString(),
  };

  statusEvents.unshift(event);
  statusEvents.splice(50);

  console.log("Callback de estado Twilio:", event);

  response.sendStatus(204);
});

app.get("/api/debug/twilio", (_request, response) => {
  response.json({
    inboundMessages,
    statusEvents,
  });
});

app.get("/staff", (_request, response) => {
  response.sendFile(path.join(ROOT, "staff.html"));
});

app.get("/menu", (_request, response) => {
  response.sendFile(path.join(ROOT, "menu.html"));
});

app.get("/menu.html", (_request, response) => {
  response.sendFile(path.join(ROOT, "menu.html"));
});

app.get("/mesa/:tableId", (_request, response) => {
  response.sendFile(path.join(ROOT, "index.html"));
});

app.get("/", (_request, response) => {
  response.sendFile(path.join(ROOT, "index.html"));
});

app.listen(PORT, () => {
  const notifierStatus = notifier.getStatus();
  console.log(`Servidor listo en http://localhost:${PORT}`);
  console.log(
    `Canal interno activo | WhatsApp fallback: ${
      ENABLE_WHATSAPP_FALLBACK ? notifierStatus.mode : "desactivado"
    }`
  );
});

function createPendingAlert({ callId, requestedAt, requestType, tableId }) {
  return {
    callCount: 1,
    id: `alert-${Date.now()}-${tableId}`,
    callId,
    createdAt: new Date().toISOString(),
    firstRequestedAt: requestedAt,
    lastRequestedAt: requestedAt,
    requestedAt,
    requestType,
    status: "pending",
    tableId,
  };
}

function buildSuccessMessage({ requestType, tableId, whatsappSent }) {
  const requestLabel =
    requestType === "bill" ? "Solicitud de cuenta" : "Solicitud de ayuda";

  if (whatsappSent) {
    return `${requestLabel} de la mesa ${tableId} registrada y reenviada por WhatsApp.`;
  }

  return `${requestLabel} de la mesa ${tableId} registrada en el panel interno.`;
}

async function sendWhatsAppFallback({ requestedAt, tableId }) {
  if (!ENABLE_WHATSAPP_FALLBACK) {
    return {
      sent: false,
    };
  }

  try {
    const result = await notifier.sendTableCall({
      requestedAt,
      tableId,
    });

    return {
      providerId: result.providerId,
      sent: true,
    };
  } catch (error) {
    console.error("No se pudo enviar el fallback por WhatsApp", error);

    return {
      error: error.message,
      sent: false,
    };
  }
}

function sanitizeTableId(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, "");

  return normalized || null;
}

function sanitizeHandledBy(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  return normalized || "Equipo de sala";
}

function sanitizeRequestType(value) {
  return value === "bill" ? "bill" : "waiter";
}

function isCoolingDown(requestedAt) {
  const elapsedSeconds = Math.floor(
    (Date.now() - new Date(requestedAt).getTime()) / 1000
  );

  return elapsedSeconds < TABLE_CALL_COOLDOWN_SECONDS;
}

function getRetryAfterSeconds(requestedAt) {
  const elapsedSeconds = Math.floor(
    (Date.now() - new Date(requestedAt).getTime()) / 1000
  );

  return Math.max(0, TABLE_CALL_COOLDOWN_SECONDS - elapsedSeconds);
}
