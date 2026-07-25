const tabs = Array.from(document.querySelectorAll(".menu-tab"));
const pages = Array.from(document.querySelectorAll(".menu-page"));
const beverageGalleries = Array.from(
  document.querySelectorAll(".beverage-group-gallery")
);
const promoPopup = document.querySelector(".promo-popup");
const promoCloseControls = Array.from(
  document.querySelectorAll("[data-promo-close]")
);
const pageScrollState = new WeakMap();
const PAGE_CHANGE_COOLDOWN_MS = 900;
const EDGE_REENTRY_PAUSE_MS = 320;
const PROMO_POPUP_DURATION_MS = 5000;

let currentIndex = 0;
let isAnimating = false;
let lastPageChangeAt = 0;
let promoPopupTimeoutId = null;

initializeMenu();

function initializeMenu() {
  const initialIndex = getIndexFromHash(window.location.hash);
  setActivePage(initialIndex, false);
  initializeBeverageGalleries();
  initializePromoPopup();

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetIndex = Number(tab.dataset.target || 0);
      if (Number.isNaN(targetIndex)) {
        return;
      }

      activatePage(targetIndex, true);
    });
  });

  pages.forEach((page) => {
    pageScrollState.set(page, {
      edgeDirection: 0,
      edgePending: false,
      edgeLastInputAt: 0,
      lastScrollTop: 0,
      touchStartY: 0,
    });

    page.addEventListener("scroll", handlePageScroll, { passive: true });
    page.addEventListener("wheel", handlePageWheel, { passive: false });
    page.addEventListener("touchstart", handleTouchStart, { passive: true });
    page.addEventListener("touchmove", handleTouchMove, { passive: false });
  });

  window.addEventListener("hashchange", () => {
    const targetIndex = getIndexFromHash(window.location.hash);
    activatePage(targetIndex, false);
  });
}

function initializeBeverageGalleries() {
  beverageGalleries.forEach((gallery) => {
    const cards = Array.from(
      gallery.querySelectorAll(".beverage-group-gallery-card")
    );

    if (cards.length === 0) {
      return;
    }

    gallery.style.setProperty("--gallery-count", String(cards.length));
    gallery.classList.toggle(
      "beverage-group-gallery--single",
      cards.length === 1
    );
    cards.forEach((card, index) => {
      card.style.setProperty("--card-index", String(index));
    });
  });
}

function initializePromoPopup() {
  if (!promoPopup) {
    return;
  }

  promoCloseControls.forEach((control) => {
    control.addEventListener("click", closePromoPopup);
  });

  window.setTimeout(() => {
    openPromoPopup();
  }, 180);
}

function openPromoPopup() {
  if (!promoPopup) {
    return;
  }

  promoPopup.hidden = false;
  promoPopup.setAttribute("aria-hidden", "false");
  document.body.classList.add("promo-popup-open");

  window.clearTimeout(promoPopupTimeoutId);
  promoPopupTimeoutId = window.setTimeout(() => {
    closePromoPopup();
  }, PROMO_POPUP_DURATION_MS);
}

function closePromoPopup() {
  if (!promoPopup || promoPopup.hidden) {
    return;
  }

  promoPopup.hidden = true;
  promoPopup.setAttribute("aria-hidden", "true");
  document.body.classList.remove("promo-popup-open");
  window.clearTimeout(promoPopupTimeoutId);
  promoPopupTimeoutId = null;
}

function getIndexFromHash(hash) {
  if (!hash) {
    return 0;
  }

  const targetId = hash.replace(/^#/, "");
  const pageIndex = pages.findIndex((page) => page.id === targetId);

  return pageIndex >= 0 ? pageIndex : 0;
}

function activatePage(targetIndex, shouldUpdateHash, options = {}) {
  const { startAtBottom = false } = options;

  if (targetIndex === currentIndex || isAnimating || !pages[targetIndex]) {
    if (shouldUpdateHash && pages[targetIndex]) {
      updateHash(pages[targetIndex].id);
    }
    return;
  }

  isAnimating = true;

  const previousPage = pages[currentIndex];
  const nextPage = pages[targetIndex];

  resetAllEdgeState();
  previousPage.classList.remove("active");
  previousPage.classList.remove("entering", "leaving");
  nextPage.classList.remove("entering", "leaving");

  previousPage.classList.add("leaving");
  nextPage.scrollTop = startAtBottom ? nextPage.scrollHeight : 0;
  nextPage.classList.add("entering");

  setTimeout(() => {
    previousPage.classList.remove("leaving");
    nextPage.classList.remove("entering");
    nextPage.classList.add("active");
    isAnimating = false;
    lastPageChangeAt = Date.now();
  }, 580);

  setActiveTab(targetIndex);
  currentIndex = targetIndex;

  if (shouldUpdateHash) {
    updateHash(nextPage.id);
  }
}

function setActivePage(targetIndex, shouldUpdateHash) {
  pages.forEach((page, index) => {
    page.classList.toggle("active", index === targetIndex);
    page.classList.remove("entering", "leaving");

    const pageState = pageScrollState.get(page);
    if (pageState) {
      resetEdgeState(pageState);
      pageState.lastScrollTop = page.scrollTop;
    }
  });

  setActiveTab(targetIndex);
  currentIndex = targetIndex;

  if (shouldUpdateHash && pages[targetIndex]) {
    updateHash(pages[targetIndex].id);
  }
}

function setActiveTab(targetIndex) {
  tabs.forEach((tab, index) => {
    const isActive = index === targetIndex;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });
}

function updateHash(id) {
  const nextHash = `#${id}`;
  if (window.location.hash === nextHash) {
    return;
  }

  window.history.replaceState(null, "", nextHash);
}

function handlePageScroll(event) {
  const page = event.currentTarget;
  if (!page.classList.contains("active") || isAnimating) {
    return;
  }

  const state = pageScrollState.get(page);
  if (!state) {
    return;
  }

  const currentTop = page.scrollTop;
  state.lastScrollTop = currentTop;

  if (!isAtBottom(page) && !isAtTop(page)) {
    resetEdgeState(state);
  }
}

function handlePageWheel(event) {
  const page = event.currentTarget;
  if (!page.classList.contains("active") || isAnimating) {
    return;
  }

  const state = pageScrollState.get(page);
  if (!state) {
    return;
  }

  if (event.deltaY > 0 && isAtBottom(page)) {
    event.preventDefault();
    handleEdgeIntent(state, 1, () => activateNeighborPage(1));
    return;
  }

  if (event.deltaY < 0 && isAtTop(page)) {
    event.preventDefault();
    handleEdgeIntent(state, -1, () => activateNeighborPage(-1));
    return;
  }

  resetEdgeState(state);
}

function handleTouchStart(event) {
  const page = event.currentTarget;
  const state = pageScrollState.get(page);
  if (!state || event.touches.length === 0) {
    return;
  }

  resetEdgeState(state);
  state.touchStartY = event.touches[0].clientY;
}

function handleTouchMove(event) {
  const page = event.currentTarget;
  const state = pageScrollState.get(page);
  if (
    !page.classList.contains("active") ||
    isAnimating ||
    !state ||
    event.touches.length === 0
  ) {
    return;
  }

  const currentY = event.touches[0].clientY;
  const deltaY = currentY - state.touchStartY;

  if (deltaY < -24 && isAtBottom(page)) {
    event.preventDefault();
    handleEdgeIntent(state, 1, () => {
      activateNeighborPage(1);
      state.touchStartY = currentY;
    });
    return;
  }

  if (deltaY > 24 && isAtTop(page)) {
    event.preventDefault();
    handleEdgeIntent(state, -1, () => {
      activateNeighborPage(-1);
      state.touchStartY = currentY;
    });
    return;
  }

  resetEdgeState(state);
}

function activateNeighborPage(offset) {
  const targetIndex = currentIndex + offset;
  if (targetIndex < 0 || targetIndex >= pages.length) {
    return;
  }

  activatePage(targetIndex, true, {
    startAtBottom: offset < 0,
  });
}

function isAtBottom(page) {
  return page.scrollTop + page.clientHeight >= page.scrollHeight - 6;
}

function isAtTop(page) {
  return page.scrollTop <= 6;
}

function handleEdgeIntent(state, direction, onConfirmed) {
  const now = Date.now();

  if (now - lastPageChangeAt < PAGE_CHANGE_COOLDOWN_MS) {
    return;
  }

  if (!state.edgePending || state.edgeDirection !== direction) {
    state.edgePending = true;
    state.edgeDirection = direction;
    state.edgeLastInputAt = now;
    return;
  }

  if (now - state.edgeLastInputAt >= EDGE_REENTRY_PAUSE_MS) {
    onConfirmed();
    return;
  }

  state.edgeLastInputAt = now;
}

function resetEdgeState(state) {
  state.edgePending = false;
  state.edgeDirection = 0;
  state.edgeLastInputAt = 0;
}

function resetAllEdgeState() {
  pages.forEach((page) => {
    const state = pageScrollState.get(page);
    if (state) {
      resetEdgeState(state);
    }
  });
}
