const POLL_INTERVAL_MS = 2000;
const VIBRATION_PATTERN = [120, 70, 120, 70, 120, 70, 160];

const elements = {
  lastRefreshValue: document.querySelector("#lastRefreshValue"),
  pendingAlerts: document.querySelector("#pendingAlerts"),
  pendingCountValue: document.querySelector("#pendingCountValue"),
  recentAlerts: document.querySelector("#recentAlerts"),
  soundToggle: document.querySelector("#soundToggle"),
  vibrationToggle: document.querySelector("#vibrationToggle"),
};

const dashboardState = {
  alarmIntervalId: null,
  audioContext: null,
  audioEnabled: false,
  pendingAlerts: [],
  vibrationAvailable:
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function",
  vibrationEnabled: false,
};

init();

function init() {
  elements.soundToggle?.addEventListener("click", handleSoundToggle);
  elements.vibrationToggle?.addEventListener("click", handleVibrationToggle);
  elements.pendingAlerts?.addEventListener("click", handlePendingAction);

  syncToggleState();
  refreshAlerts();
  window.setInterval(refreshAlerts, POLL_INTERVAL_MS);
}

async function refreshAlerts() {
  try {
    const previousAlerts = dashboardState.pendingAlerts.map((alert) => ({
      callCount: alert.callCount || 1,
      id: alert.id,
    }));
    const response = await fetch("/api/staff/alerts");

    if (!response.ok) {
      throw new Error(`Alerts failed with ${response.status}`);
    }

    const data = await response.json();
    const pendingAlerts = Array.isArray(data.pendingAlerts)
      ? [...data.pendingAlerts].sort(comparePendingAlerts)
      : [];
    const recentAlerts = Array.isArray(data.recentAlerts)
      ? data.recentAlerts.slice(0, 3)
      : [];

    dashboardState.pendingAlerts = pendingAlerts;

    renderPendingAlerts(pendingAlerts);
    renderRecentAlerts(recentAlerts);
    renderSummary({
      pendingCount: pendingAlerts.length,
      serverTime: data.serverTime,
    });

    if (hasNewOrEscalatedAlert(previousAlerts, pendingAlerts)) {
      triggerVibration();
    }

    syncAlarmState();
  } catch (error) {
    console.error("No se pudieron cargar las alertas", error);
    renderPendingErrorState();
  }
}

async function handleSoundToggle() {
  const nextEnabled = !dashboardState.audioEnabled;

  if (!nextEnabled) {
    dashboardState.audioEnabled = false;
    stopAlarmLoop();
    syncToggleState();
    return;
  }

  try {
    await ensureAudioContext();
    dashboardState.audioEnabled = true;
    syncToggleState();
    syncAlarmState();
  } catch (error) {
    console.error("No se pudo activar el audio", error);
    dashboardState.audioEnabled = false;
    syncToggleState();
  }
}

function handleVibrationToggle() {
  if (!dashboardState.vibrationAvailable) {
    dashboardState.vibrationEnabled = false;
    syncToggleState();
    return;
  }

  dashboardState.vibrationEnabled = !dashboardState.vibrationEnabled;
  syncToggleState();

  if (dashboardState.vibrationEnabled && dashboardState.pendingAlerts.length > 0) {
    triggerVibration();
  }
}

async function handlePendingAction(event) {
  const actionButton = event.target.closest("[data-action='acknowledge']");

  if (!actionButton) {
    return;
  }

  const alertId = actionButton.getAttribute("data-alert-id");
  actionButton.disabled = true;
  actionButton.textContent = "Atendiendo...";

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
      throw new Error(data?.message || "No se pudo atender la mesa.");
    }

    await refreshAlerts();
  } catch (error) {
    console.error(error);
    actionButton.disabled = false;
    actionButton.textContent = "Atender mesa";
  }
}

function renderSummary({ pendingCount, serverTime }) {
  elements.pendingCountValue.textContent = String(pendingCount);
  elements.lastRefreshValue.textContent = formatClock(serverTime);
  document.title =
    pendingCount > 0
      ? `(${pendingCount}) Alerta de mesas | Quinayas Cafe`
      : "Panel de sala | Quinayas Cafe";
}

function renderPendingAlerts(alerts) {
  if (alerts.length === 0) {
    elements.pendingAlerts.innerHTML = `
      <article class="alert-card alert-card-empty">
        <p class="status-message">No hay solicitudes activas.</p>
      </article>
    `;
    return;
  }

  elements.pendingAlerts.innerHTML = alerts
    .map(
      (alert) => `
        <article class="alert-card alert-card-live ${getRequestTypeClass(
          alert.requestType
        )}">
          <div class="alert-card-title-row">
            <h3 class="alert-table-name">${escapeHtml(alert.tableId)}</h3>
          </div>
          <div class="alert-card-info-row">
            <span class="table-badge alert-count-badge">
              ${formatCallCount(alert.callCount)}
            </span>
            <span class="table-badge table-badge-alert">
              ${formatElapsed(alert.firstRequestedAt || alert.requestedAt)}
            </span>
          </div>
          <button
            class="primary-button alert-action"
            type="button"
            data-action="acknowledge"
            data-alert-id="${escapeHtml(alert.id)}"
          >
            Atender mesa
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
        <p class="status-message">Sin historial reciente.</p>
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
              <p class="status-label">${escapeHtml(alert.tableId)}</p>
              <p class="status-message">Atendida</p>
            </div>
            <span class="table-badge">
              ${formatWaitDuration(
                alert.firstRequestedAt || alert.requestedAt,
                alert.acknowledgedAt
              )}
            </span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderPendingErrorState() {
  elements.pendingAlerts.innerHTML = `
    <article class="alert-card alert-card-empty">
      <p class="status-message">No pudimos actualizar el panel.</p>
    </article>
  `;
}

function syncAlarmState() {
  if (!dashboardState.audioEnabled) {
    stopAlarmLoop();
    return;
  }

  if (dashboardState.pendingAlerts.length > 0) {
    startAlarmLoop();
    return;
  }

  stopAlarmLoop();
}

function syncToggleState() {
  syncSingleToggle(elements.soundToggle, dashboardState.audioEnabled, false);
  syncSingleToggle(
    elements.vibrationToggle,
    dashboardState.vibrationEnabled,
    !dashboardState.vibrationAvailable
  );
}

function syncSingleToggle(element, checked, disabled) {
  if (!element) {
    return;
  }

  element.setAttribute("aria-checked", checked ? "true" : "false");
  element.toggleAttribute("data-on", checked);
  element.disabled = disabled;
}

function triggerVibration() {
  if (!dashboardState.vibrationEnabled || !dashboardState.vibrationAvailable) {
    return;
  }

  navigator.vibrate(VIBRATION_PATTERN);
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

function hasNewOrEscalatedAlert(previousAlerts, nextAlerts) {
  const previousById = new Map(
    previousAlerts.map((alert) => [alert.id, alert.callCount || 1])
  );

  return nextAlerts.some((alert) => {
    const previousCount = previousById.get(alert.id);

    if (previousCount == null) {
      return true;
    }

    return (alert.callCount || 1) > previousCount;
  });
}

function getRequestTypeClass(requestType) {
  return requestType === "bill"
    ? "alert-card-request-bill"
    : "alert-card-request-waiter";
}

function comparePendingAlerts(left, right) {
  const leftTime = new Date(
    left.firstRequestedAt || left.requestedAt || left.createdAt
  ).getTime();
  const rightTime = new Date(
    right.firstRequestedAt || right.requestedAt || right.createdAt
  ).getTime();

  return leftTime - rightTime;
}

function formatCallCount(callCount) {
  const count = Math.max(1, Number(callCount) || 1);
  return count === 1 ? "1 llamado" : `${count} llamados`;
}

function formatElapsed(timestamp) {
  const diffMs = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);

  if (minutes <= 0) {
    return `Hace ${Math.max(totalSeconds, 1)}s`;
  }

  if (minutes < 60) {
    return `Hace ${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `Hace ${hours}h`;
  }

  return `Hace ${hours}h ${remainingMinutes}m`;
}

function formatWaitDuration(startTimestamp, endTimestamp) {
  const diffMs = Math.max(
    0,
    new Date(endTimestamp).getTime() - new Date(startTimestamp).getTime()
  );
  const totalMinutes = Math.max(1, Math.round(diffMs / 60000));

  return totalMinutes === 1
    ? "Espero 1m"
    : `Espero ${totalMinutes}m`;
}

function formatClock(timestamp) {
  if (!timestamp) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("es-CO", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
