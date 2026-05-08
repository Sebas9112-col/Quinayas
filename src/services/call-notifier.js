const twilio = require("twilio");

function createCallNotifier(config) {
  const mode = resolveMode(config);
  const client =
    mode === "twilio"
      ? twilio(config.accountSid, config.authToken)
      : null;

  return {
    getStatus() {
      return {
        mode,
        strategy: config.contentSid ? "template" : "free-form",
        target: config.to || null,
        twilioReady: mode === "twilio",
      };
    },

    async sendTableCall({ tableId, requestedAt }) {
      if (mode !== "twilio") {
        return {
          mode: "demo",
          providerId: `demo-${Date.now()}`,
          message: `Mesa ${tableId} registrada en modo demo.`,
        };
      }

      const message = await client.messages.create(
        buildMessagePayload({
          cafeName: config.cafeName,
          contentSid: config.contentSid,
          from: config.from,
          messagingServiceSid: config.messagingServiceSid,
          requestedAt,
          statusCallback: config.statusCallback,
          tableId,
          to: config.to,
        })
      );

      return {
        mode: "twilio",
        providerId: message.sid,
        message: `Mesa ${tableId} notificada por WhatsApp.`,
      };
    },
  };
}

function resolveMode(config) {
  if (config.useDemo) {
    return "demo";
  }

  if (config.accountSid && config.authToken && config.from && config.to) {
    return "twilio";
  }

  return "demo";
}

function buildMessagePayload({
  cafeName,
  contentSid,
  from,
  messagingServiceSid,
  requestedAt,
  statusCallback,
  tableId,
  to,
}) {
  const payload = {
    from,
    to,
  };

  if (messagingServiceSid) {
    payload.messagingServiceSid = messagingServiceSid;
  }

  if (statusCallback) {
    payload.statusCallback = statusCallback;
  }

  if (contentSid) {
    payload.contentSid = contentSid;
    payload.contentVariables = JSON.stringify({
      1: tableId,
      2: formatTime(requestedAt),
      3: cafeName,
    });

    return payload;
  }

  payload.body = formatMessage({
    cafeName,
    requestedAt,
    tableId,
  });

  return payload;
}

function formatMessage({ cafeName, requestedAt, tableId }) {
  return [
    `${cafeName}: solicitud de atencion`,
    `Mesa: ${tableId}`,
    `Hora: ${formatTime(requestedAt)}`,
    "Accion: acercarse a la mesa",
  ].join("\n");
}

function formatTime(requestedAt) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(requestedAt));
}

module.exports = {
  createCallNotifier,
};
