const tabs = Array.from(document.querySelectorAll(".menu-tab"));
const pages = Array.from(document.querySelectorAll(".menu-page"));
const pageScrollState = new WeakMap();

let currentIndex = 0;
let isAnimating = false;

initializeMenu();

function initializeMenu() {
  const initialIndex = getIndexFromHash(window.location.hash);
  setActivePage(initialIndex, false);

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
  const direction = currentTop - state.lastScrollTop;
  state.lastScrollTop = currentTop;

  if (direction > 0 && isAtBottom(page)) {
    activateNeighborPage(1);
    return;
  }

  if (direction < 0 && isAtTop(page)) {
    activateNeighborPage(-1);
  }
}

function handlePageWheel(event) {
  const page = event.currentTarget;
  if (!page.classList.contains("active") || isAnimating) {
    return;
  }

  if (event.deltaY > 0 && isAtBottom(page)) {
    event.preventDefault();
    activateNeighborPage(1);
    return;
  }

  if (event.deltaY < 0 && isAtTop(page)) {
    event.preventDefault();
    activateNeighborPage(-1);
  }
}

function handleTouchStart(event) {
  const page = event.currentTarget;
  const state = pageScrollState.get(page);
  if (!state || event.touches.length === 0) {
    return;
  }

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
    activateNeighborPage(1);
    state.touchStartY = currentY;
    return;
  }

  if (deltaY > 24 && isAtTop(page)) {
    event.preventDefault();
    activateNeighborPage(-1);
    state.touchStartY = currentY;
  }
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
