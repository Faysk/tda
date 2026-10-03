(function () {
  "use strict";

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function targetFor(entry, mode) {
    if (!entry) return null;
    if (mode === "reading") {
      return entry.reading ? document.getElementById(entry.reading) : null;
    }
    return entry.cinematic ? document.querySelector(entry.cinematic) : null;
  }

  function captureMappedLocation(entries, mode, options) {
    const offset = options?.offset ?? 110;
    let best = null;

    for (const entry of entries) {
      const element = targetFor(entry, mode);
      if (!element || element.hidden) continue;

      const rect = element.getBoundingClientRect();
      if (rect.height <= 0) continue;

      const containsAnchor = rect.top <= offset && rect.bottom >= offset;
      const distance = containsAnchor
        ? 0
        : Math.min(Math.abs(rect.top - offset), Math.abs(rect.bottom - offset));

      if (!best || distance < best.distance) {
        best = {
          entry,
          distance,
          progress: clamp((offset - rect.top) / rect.height, 0, 1),
        };
      }
    }

    return best
      ? { entry: best.entry, progress: best.progress }
      : { entry: entries[0] ?? null, progress: 0 };
  }

  function restoreMappedLocation(snapshot, mode, options) {
    if (!snapshot?.entry) return null;
    const target = targetFor(snapshot.entry, mode);
    if (!target) return null;

    const offset = options?.offset ?? 110;
    const rect = target.getBoundingClientRect();
    const progress = clamp(snapshot.progress ?? 0, 0, 1);
    const targetY = window.scrollY + rect.top + rect.height * progress - offset;

    const top = Math.max(0, Math.round(targetY));
    const scroller = document.scrollingElement || document.documentElement;
    if (scroller) {
      // Keep the continuity jump deterministic. "auto" can still inherit
      // CSS scroll-behavior:smooth and briefly expose the wrong chapter.
      scroller.scrollTop = top;
    } else {
      window.scrollTo(0, top);
    }

    return target;
  }

  function preserveCatalogReturn(link, options) {
    if (!link || !document.referrer) return false;

    const catalogPath = options?.catalogPath ?? "/lore";
    let referrer;
    try {
      referrer = new URL(document.referrer, window.location.href);
    } catch {
      return false;
    }

    if (referrer.origin !== window.location.origin || referrer.pathname !== catalogPath) {
      return false;
    }

    link.setAttribute("href", `${referrer.pathname}${referrer.search}${referrer.hash}`);
    return true;
  }

  window.TDALoreModeContinuity = Object.freeze({
    captureMappedLocation,
    restoreMappedLocation,
    preserveCatalogReturn,
  });
})();
