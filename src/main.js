const DEMO_LATENCY_MS = 900;
const COOLDOWN_SECONDS = 45;

const elements = {
  callButton: document.querySelector("#callButton"),
  helperText: document.querySelector("#helperText"),
  lastCallValue: document.querySelector("#lastCallValue"),
  modeBanner: document.querySelector("#modeBanner"),
  statusMessage: document.querySelector("#statusMessage"),
  tableBadge: document.querySelector("#tableBadge"),
  tableIdValue: document.querySelector("#tableIdValue"),
};

const tableContext = getTableContext();
const storageKey = `quinayas:last-call:${tableContext.tableId}`;
const appState = {
  channels: {
    internalDesk: true,
    whatsappFallback: false,
  },
};

hydrate();
elements.callButton?.addEventListener("click", handleCallRequest);

async function hydrate() {
  const lastCall = readLastCall();

  updateTable(tableContext.tableId);
  await loadServerStatus();
  renderLastCall(lastCall);

  if (lastCall && isCoolingDown(lastCall.requestedAt)) {
    startCooldown(lastCall.requestedAt);
    return;
  }

  setReadyState();
}

function getTableContext() {
  const { pathname, searchParams } = new URL(window.location.href);
  const pathParts = pathname.split("/").filter(Boolean);
  const pathTable = pathParts[0] === "mesa" ? pathParts[1] : null;
  const queryTable = searchParams.get("mesa");
  const token = searchParams.get("token");

  return {
    tableId: sanitizeTableId(pathTable || queryTable || "demo-01"),
    token: token || null,
  };
}

function sanitizeTableId(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9-_]/g, "") || "demo-01";
}

function updateTable(tableId) {
  elements.tableBadge.textContent = `Mesa ${tableId}`;
  elements.tableIdValue.textContent = tableId;
}

function renderModeBanner() {
  if (appState.channels.whatsappFallback) {
    elements.modeBanner.hidden = false;
    elements.modeBanner.textContent =
      "Panel interno activo. WhatsApp disponible como respaldo.";
    return;
  }

  elements.modeBanner.hidden = true;
  elements.modeBanner.textContent = "";
}

async function loadServerStatus() {
  try {
    const response = await fetch("/api/status");

    if (!response.ok) {
      throw new Error(`Status failed with ${response.status}`);
    }

    const data = await response.json();
    appState.channels.internalDesk = data?.channels?.internalDesk?.enabled !== false;
    appState.channels.whatsappFallback =
      Boolean(data?.channels?.whatsappFallback?.enabled) &&
      data?.channels?.whatsappFallback?.mode === "twilio";
  } catch (error) {
    console.error("No se pudo cargar el estado del servidor", error);
    appState.channels.internalDesk = true;
    appState.channels.whatsappFallback = false;
  } finally {
    renderModeBanner();
  }
}

async function handleCallRequest() {
  elements.callButton.disabled = true;
  elements.callButton.textContent = "Enviando...";
  elements.statusMessage.textContent = "Estamos avisando al personal.";
  elements.helperText.textContent =
    "Tu solicitud se está registrando en este momento.";

  try {
    const result = await notifyWaiter({
      requestedAt: new Date().toISOString(),
      tableId: tableContext.tableId,
      token: tableContext.token,
    });

    const requestedAt = result.requestedAt || new Date().toISOString();
    writeLastCall({ requestedAt, callId: result.callId || null });
    renderLastCall({ requestedAt });
    setSuccessState(result.message || "Llamado enviado correctamente.");
    startCooldown(requestedAt);
  } catch (error) {
    console.error(error);
    setErrorState(
      error.message ||
        "No pudimos enviar el llamado. Intenta nuevamente en unos segundos."
    );
  }
}

async function notifyWaiter(payload) {
  const response = await fetch("/api/calls", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: "web",
      requestedAt: payload.requestedAt,
      tableId: payload.tableId,
      token: payload.token,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status >= 500) {
      await wait(DEMO_LATENCY_MS);
    }

    const retryHint = data?.retryAfterSeconds
      ? ` Intenta de nuevo en ${data.retryAfterSeconds}s.`
      : "";

    throw new Error(
      (data?.message || `Request failed with status ${response.status}`) +
        retryHint
    );
  }

  appState.channels.whatsappFallback = Boolean(
    data?.channels?.whatsappFallback
  );
  renderModeBanner();

  return {
    callId: data.callId,
    message: data.message,
    requestedAt: data.requestedAt || payload.requestedAt,
  };
}

function setReadyState() {
  elements.callButton.disabled = false;
  elements.callButton.textContent = "Solicitar ayuda";
  elements.statusMessage.textContent = "Estamos atentos a tu mesa.";
  elements.helperText.textContent = "Presiona el botón si necesitas apoyo.";
}

function setSuccessState(message) {
  elements.callButton.textContent = "Ayuda solicitada";
  elements.statusMessage.textContent = message || "Solicitud recibida.";
  elements.helperText.textContent = "El personal irá en camino.";
}

function setErrorState(message) {
  elements.callButton.disabled = false;
  elements.callButton.textContent = "Volver a intentar";
  elements.statusMessage.textContent = message;
  elements.helperText.textContent =
    "Verifica la conexión o inténtalo nuevamente en unos segundos.";
}

function renderLastCall(lastCall) {
  if (!lastCall?.requestedAt) {
    elements.lastCallValue.textContent = "Sin registros";
    return;
  }

  const formatted = new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(lastCall.requestedAt));

  elements.lastCallValue.textContent = `Hoy a las ${formatted}`;
}

function startCooldown(requestedAt) {
  const requestedTime = new Date(requestedAt).getTime();

  tickCooldown();
  const interval = window.setInterval(tickCooldown, 1000);

  function tickCooldown() {
    const secondsLeft = Math.max(
      0,
      COOLDOWN_SECONDS - Math.floor((Date.now() - requestedTime) / 1000)
    );

    if (secondsLeft <= 0) {
      window.clearInterval(interval);
      setReadyState();
      return;
    }

    elements.callButton.disabled = true;
    elements.callButton.textContent = `Espera ${secondsLeft}s`;
    elements.statusMessage.textContent = "Ya hay una solicitud activa.";
    elements.helperText.textContent = "El personal irá en camino.";
  }
}

function isCoolingDown(requestedAt) {
  const elapsedSeconds = Math.floor(
    (Date.now() - new Date(requestedAt).getTime()) / 1000
  );

  return elapsedSeconds < COOLDOWN_SECONDS;
}

function readLastCall() {
  try {
    const rawValue = window.localStorage.getItem(storageKey);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch (error) {
    console.error("No se pudo leer el ultimo llamado", error);
    return null;
  }
}

function writeLastCall(value) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch (error) {
    console.error("No se pudo guardar el ultimo llamado", error);
  }
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
