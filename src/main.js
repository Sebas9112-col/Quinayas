const DEMO_LATENCY_MS = 900;
const COOLDOWN_SECONDS = 45;
const TABLE_STATUS_POLL_MS = 3000;
const ASSIGNMENT_MESSAGE_DURATION_MS = 5 * 60 * 1000;

const elements = {
  actionButtons: Array.from(document.querySelectorAll("[data-request-type]")),
  billButton: document.querySelector("#billButton"),
  helperText: document.querySelector("#helperText"),
  modeBanner: document.querySelector("#modeBanner"),
  statusMessage: document.querySelector("#statusMessage"),
  tableBadge: document.querySelector("#tableBadge"),
  tableIdValue: document.querySelector("#tableIdValue"),
  waiterButton: document.querySelector("#waiterButton"),
};

const tableContext = getTableContext();
const appState = {
  assignedWaiter: null,
  channels: {
    internalDesk: true,
    whatsappFallback: false,
  },
  latestAssignmentKey: null,
};

hydrate();
elements.actionButtons.forEach((button) => {
  button.addEventListener("click", handleCallRequest);
});
window.setInterval(syncTableStatus, TABLE_STATUS_POLL_MS);

async function hydrate() {
  updateTable(tableContext.tableId);
  await loadServerStatus();
  await syncTableStatus();

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

async function handleCallRequest(event) {
  const requestType = event.currentTarget?.dataset.requestType || "waiter";

  setButtonsDisabled(true);
  updateActionButtonLabel(requestType, "Enviando...");
  elements.statusMessage.textContent = "Estamos avisando al personal.";
  elements.helperText.textContent =
    "Tu solicitud se está registrando en este momento.";

  try {
    const result = await notifyWaiter({
      requestType,
      requestedAt: new Date().toISOString(),
      tableId: tableContext.tableId,
      token: tableContext.token,
    });

    const requestedAt = result.requestedAt || new Date().toISOString();
    setSuccessState(
      requestType,
      result.message || "Solicitud enviada correctamente."
    );
    await syncTableStatus();
    startCooldown(requestedAt, requestType);
  } catch (error) {
    console.error(error);
    setErrorState(
      requestType,
      error.message ||
        "No pudimos enviar la solicitud. Intenta nuevamente en unos segundos."
    );
  }
}

async function notifyWaiter(payload) {
  if (window.location.protocol === "file:") {
    throw new Error(
      "Para enviar solicitudes debes abrir la app desde el servidor local o desde internet, no con file://."
    );
  }

  const response = await fetch("/api/calls", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: "web",
      requestType: payload.requestType,
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
  setButtonsDisabled(false);
  elements.waiterButton.textContent = "Llamar al mesero";
  elements.billButton.textContent = "Solicitar cuenta";
  elements.statusMessage.textContent = "Estamos atentos a tu mesa.";
  elements.helperText.textContent = getDefaultHelperText();
}

function setSuccessState(requestType, message) {
  updateActionButtonLabel(
    requestType,
    requestType === "bill" ? "Cuenta solicitada" : "Ayuda solicitada"
  );
  elements.statusMessage.textContent = message || "Solicitud recibida.";
  elements.helperText.textContent = getAssignmentAwareHelperText();
}

function setErrorState(requestType, message) {
  setButtonsDisabled(false);
  updateActionButtonLabel(
    requestType,
    requestType === "bill" ? "Solicitar cuenta" : "Llamar al mesero"
  );
  elements.statusMessage.textContent = message;
  elements.helperText.textContent = isAssignmentMessageActive()
    ? getAssignmentAwareHelperText()
    : "Verifica la conexión o inténtalo nuevamente en unos segundos.";
}

function startCooldown(requestedAt, requestType) {
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

    setButtonsDisabled(true);
    updateActionButtonLabel(
      requestType,
      requestType === "bill"
        ? `Cuenta en ${secondsLeft}s`
        : `Espera ${secondsLeft}s`
    );
    elements.statusMessage.textContent = "Ya hay una solicitud activa.";
    elements.helperText.textContent = getAssignmentAwareHelperText();
  }
}

async function syncTableStatus() {
  try {
    const response = await fetch(
      `/api/tables/${encodeURIComponent(tableContext.tableId)}/status`
    );

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const assignment = data?.latestAssignment;

    if (!assignment?.handledBy) {
      return;
    }

    const assignmentKey = `${assignment.callId}:${assignment.handledBy}`;

    if (assignmentKey === appState.latestAssignmentKey) {
      refreshAssignmentMessage();
      return;
    }

    appState.latestAssignmentKey = assignmentKey;
    appState.assignedWaiter = {
      expiresAt:
        new Date(assignment.acknowledgedAt).getTime() +
        ASSIGNMENT_MESSAGE_DURATION_MS,
      handledBy: assignment.handledBy,
    };
    refreshAssignmentMessage();
  } catch (error) {
    console.error("No se pudo sincronizar el estado de la mesa", error);
  }
}

function isCoolingDown(requestedAt) {
  const elapsedSeconds = Math.floor(
    (Date.now() - new Date(requestedAt).getTime()) / 1000
  );

  return elapsedSeconds < COOLDOWN_SECONDS;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setButtonsDisabled(disabled) {
  elements.actionButtons.forEach((button) => {
    button.disabled = disabled;
  });
}

function updateActionButtonLabel(requestType, text) {
  const targetButton =
    requestType === "bill" ? elements.billButton : elements.waiterButton;

  if (targetButton) {
    targetButton.textContent = text;
  }
}

function refreshAssignmentMessage() {
  elements.helperText.textContent = getAssignmentAwareHelperText();
}

function getAssignmentAwareHelperText() {
  if (isAssignmentMessageActive()) {
    return `${appState.assignedWaiter.handledBy} va en camino.`;
  }

  return "El personal irá en camino.";
}

function getDefaultHelperText() {
  if (isAssignmentMessageActive()) {
    return `${appState.assignedWaiter.handledBy} va en camino.`;
  }

  return "Presiona el botón si necesitas apoyo.";
}

function isAssignmentMessageActive() {
  if (!appState.assignedWaiter?.handledBy || !appState.assignedWaiter?.expiresAt) {
    return false;
  }

  if (Date.now() > appState.assignedWaiter.expiresAt) {
    appState.assignedWaiter = null;
    return false;
  }

  return true;
}
