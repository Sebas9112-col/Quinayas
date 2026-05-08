const POLL_INTERVAL_MS = 2000;

const elements = {
  armAlarmButton: document.querySelector("#armAlarmButton"),
  lastRefreshValue: document.querySelector("#lastRefreshValue"),
  pendingAlerts: document.querySelector("#pendingAlerts"),
  pendingCountValue: document.querySelector("#pendingCountValue"),
  pendingHint: document.querySelector("#pendingHint"),
  recentAlerts: document.querySelector("#recentAlerts"),
};

const dashboardState = {
  alarmIntervalId: null,
  audioContext: null,
  audioEnabled: false,
  newestPendingId: null,
  pendingAlerts: [],
};

init();

function init() {
  elements.armAlarmButton?.addEventListener("click", handleArmAlarm);
  elements.pendingAlerts?.addEventListener("click", handlePendingAction);

  refreshAlerts();
  window.setInterval(refreshAlerts, POLL_INTERVAL_MS);
}

async function refreshAlerts() {
  try {
    const response = await fetch("/api/staff/alerts");

    if (!response.ok) {
      throw new Error(`Alerts failed with ${response.status}`);
    }

    const data = await response.json();
    const pendingAlerts = Array.isArray(data.pendingAlerts)
      ? data.pendingAlerts
      : [];
    const recentAlerts = Array.isArray(data.recentAlerts)
      ? data.recentAlerts
      : [];

    dashboardState.pendingAlerts = pendingAlerts;
    dashboardState.newestPendingId = pendingAlerts[0]?.id || null;

    renderPendingAlerts(pendingAlerts);
    renderRecentAlerts(recentAlerts);
    renderSummary({
      pendingCount: pendingAlerts.length,
      serverTime: data.serverTime,
    });
    syncAlarmState();
  } catch (error) {
    console.error("No se pudieron cargar las alertas", error);
    elements.pendingHint.textContent =
      "No pudimos actualizar las alertas. Verifica la conexion con el servidor.";
  }
}

async function handleArmAlarm() {
  try {
    await ensureAudioContext();
    dashboardState.audioEnabled = true;
    elements.armAlarmButton.textContent = "Sonido activo";
    syncAlarmState();
  } catch (error) {
    console.error("No se pudo activar el audio", error);
    elements.armAlarmButton.textContent = "Reintentar sonido";
  }
}

async function handlePendingAction(event) {
  const actionButton = event.target.closest("[data-action='acknowledge']");

  if (!actionButton) {
    return;
  }

  const alertId = actionButton.getAttribute("data-alert-id");
  actionButton.disabled = true;
  actionButton.textContent = "Marcando...";

  try {
    const response = await fetch(`/api/staff/alerts/${alertId}/acknowledge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        handledBy: getHandledBy(),
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.message || "No se pudo marcar la alerta.");
    }

    await refreshAlerts();
  } catch (error) {
    console.error(error);
    actionButton.disabled = false;
    actionButton.textContent = "Marcar atendida";
    elements.pendingHint.textContent =
      error.message || "No se pudo marcar la alerta.";
  }
}

function renderSummary({ pendingCount, serverTime }) {
  elements.pendingCountValue.textContent = String(pendingCount);
  elements.lastRefreshValue.textContent = formatClock(serverTime);

  if (pendingCount > 0) {
    elements.pendingHint.textContent =
      "Hay mesas esperando atencion. La alarma se apaga al atender la alerta.";
    document.title = `(${pendingCount}) Alerta de mesas | Quinayas Cafe`;
    return;
  }

  elements.pendingHint.textContent =
    "Sin solicitudes pendientes. El panel seguira escuchando nuevas mesas.";
  document.title = "Panel de sala | Quinayas Cafe";
}

function renderPendingAlerts(alerts) {
  if (alerts.length === 0) {
    elements.pendingAlerts.innerHTML = `
      <article class="alert-card alert-card-empty">
        <p class="status-label">Todo al dia</p>
        <p class="status-message">No hay mesas pendientes por atender.</p>
      </article>
    `;
    return;
  }

  elements.pendingAlerts.innerHTML = alerts
    .map(
      (alert) => `
        <article class="alert-card alert-card-live">
          <div class="alert-card-top">
            <div>
              <p class="status-label">Mesa ${escapeHtml(alert.tableId)}</p>
              <p class="status-message">Solicitud activa</p>
            </div>
            <span class="table-badge table-badge-alert">
              ${formatElapsed(alert.requestedAt)}
            </span>
          </div>
          <p class="alert-meta">
            Recibida a las ${formatClock(alert.requestedAt)}.
          </p>
          <button
            class="primary-button alert-action"
            type="button"
            data-action="acknowledge"
            data-alert-id="${escapeHtml(alert.id)}"
          >
            Marcar atendida
          </button>
        </article>
      `
    )
    .join("");
}

function renderRecentAlerts(alerts) {
  if (alerts.length === 0) {
    elements.recentAlerts.innerHTML = `
      <article class="alert-card alert-card-empty">
        <p class="status-label">Sin historial reciente</p>
        <p class="helper-text">
          Cuando los meseros atiendan mesas, apareceran aqui.
        </p>
      </article>
    `;
    return;
  }

  elements.recentAlerts.innerHTML = alerts
    .map(
      (alert) => `
        <article class="alert-card alert-card-muted">
          <div class="alert-card-top">
            <div>
              <p class="status-label">Mesa ${escapeHtml(alert.tableId)}</p>
              <p class="status-message">Atendida por ${escapeHtml(
                alert.handledBy
              )}</p>
            </div>
            <span class="table-badge">
              ${formatWaitDuration(alert.requestedAt, alert.acknowledgedAt)}
            </span>
          </div>
          <p class="alert-meta">
            Atendida a las ${formatClock(alert.acknowledgedAt)}.
          </p>
        </article>
      `
    )
    .join("");
}

function syncAlarmState() {
  if (!dashboardState.audioEnabled) {
    return;
  }

  if (dashboardState.pendingAlerts.length > 0) {
    startAlarmLoop();
    return;
  }

  stopAlarmLoop();
}

async function ensureAudioContext() {
  if (!("AudioContext" in window || "webkitAudioContext" in window)) {
    throw new Error("Audio API no soportada");
  }

  const Context = window.AudioContext || window.webkitAudioContext;

  if (!dashboardState.audioContext) {
    dashboardState.audioContext = new Context();
  }

  if (dashboardState.audioContext.state === "suspended") {
    await dashboardState.audioContext.resume();
  }
}

function startAlarmLoop() {
  if (dashboardState.alarmIntervalId) {
    return;
  }

  playAlarmBurst();
  dashboardState.alarmIntervalId = window.setInterval(playAlarmBurst, 1600);
}

function stopAlarmLoop() {
  if (!dashboardState.alarmIntervalId) {
    return;
  }

  window.clearInterval(dashboardState.alarmIntervalId);
  dashboardState.alarmIntervalId = null;
}

function playAlarmBurst() {
  if (!dashboardState.audioContext) {
    return;
  }

  const audioContext = dashboardState.audioContext;
  const startTime = audioContext.currentTime;

  scheduleTone(audioContext, startTime, 880, 0.18);
  scheduleTone(audioContext, startTime + 0.28, 740, 0.18);
  scheduleTone(audioContext, startTime + 0.56, 880, 0.24);
}

function scheduleTone(audioContext, startTime, frequency, duration) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.14, startTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

function getHandledBy() {
  return "Equipo de sala";
}

function formatClock(value) {
  if (!value) {
    return "Sin dato";
  }

  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatElapsed(value) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  );

  if (seconds < 60) {
    return `Hace ${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  return `Hace ${minutes}m`;
}

function formatWaitDuration(requestedAt, acknowledgedAt) {
  const diffSeconds = Math.max(
    0,
    Math.floor(
      (new Date(acknowledgedAt).getTime() - new Date(requestedAt).getTime()) /
        1000
    )
  );

  if (diffSeconds < 60) {
    return `Espero ${diffSeconds}s`;
  }

  const minutes = Math.floor(diffSeconds / 60);
  return `Espero ${minutes}m`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
