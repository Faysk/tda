const qualityGuardHref = "/lore/d/quality-guard.css";
if (!document.querySelector(`link[href="${qualityGuardHref}"]`)) {
  const qualityGuard = document.createElement("link");
  qualityGuard.rel = "stylesheet";
  qualityGuard.href = qualityGuardHref;
  document.head.append(qualityGuard);
}

const ASSETS = {
  "d-completo": {
    primary: {
      mime: "image/avif",
      path: "/lore/d/assets/d-completo-hq.avif.b64",
    },
    fallback: {
      mime: "image/png",
      paths: [
        "/lore/d/assets/base64/d-completo-fixed.0.b64",
        "/lore/d/assets/base64/d-completo-fixed.1.b64",
        "/lore/d/assets/base64/d-completo-fixed.2.b64",
      ],
    },
  },
  "d-sem-sobretudo": {
    primary: {
      mime: "image/avif",
      path: "/lore/d/assets/d-sem-sobretudo-hq.avif.b64",
    },
    fallback: {
      mime: "image/avif",
      paths: [
        "/lore/d/assets/base64/d-sem-sobretudo.0.b64",
        "/lore/d/assets/base64/d-sem-sobretudo.1.b64",
        "/lore/d/assets/base64/d-sem-sobretudo.2.b64",
      ],
    },
  },
  "d-sem-chapeu": {
    primary: {
      mime: "image/avif",
      path: "/lore/d/assets/d-sem-chapeu-hq.avif.b64",
    },
    fallback: {
      mime: "image/png",
      paths: [
        "/lore/d/assets/base64/d-sem-chapeu-fixed.0.b64",
        "/lore/d/assets/base64/d-sem-chapeu-fixed.1.b64",
        "/lore/d/assets/base64/d-sem-chapeu-fixed.2.b64",
      ],
    },
  },
};

function applyCharacterImage(name, url, quality) {
  document.querySelectorAll(`[data-d-image="${name}"]`).forEach((element) => {
    element.dataset.artworkQuality = quality;
    if (element instanceof HTMLImageElement) element.src = url;
    if (element instanceof HTMLButtonElement) element.dataset.image = url;
  });
}

async function fetchText(path) {
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
  return (await response.text()).replace(/\s+/g, "");
}

async function buildAssetUrl(asset) {
  if (asset.path) {
    const base64 = await fetchText(asset.path);
    if (!base64) throw new Error(`Empty artwork payload: ${asset.path}`);
    return `data:${asset.mime};base64,${base64}`;
  }

  if (asset.paths) {
    const parts = await Promise.all(asset.paths.map(fetchText));
    const base64 = parts.join("");
    if (!base64) throw new Error("Empty artwork payload");
    return `data:${asset.mime};base64,${base64}`;
  }

  throw new Error("Invalid artwork asset definition");
}

function assertRenderable(url) {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () => {
      if (probe.naturalWidth > 0 && probe.naturalHeight > 0) resolve(url);
      else reject(new Error("Artwork decoded with zero dimensions"));
    };
    probe.onerror = () => reject(new Error("Browser could not decode artwork"));
    probe.src = url;
  });
}

async function hydrateCharacterImage(name) {
  const asset = ASSETS[name];
  if (!asset) return;

  try {
    const primaryUrl = await buildAssetUrl(asset.primary);
    await assertRenderable(primaryUrl);
    applyCharacterImage(name, primaryUrl, "hq");
    return;
  } catch (error) {
    console.warn(`HQ artwork failed for ${name}; using stable fallback`, error);
  }

  const fallbackUrl = await buildAssetUrl(asset.fallback);
  await assertRenderable(fallbackUrl);
  applyCharacterImage(name, fallbackUrl, "fallback");
}

Object.keys(ASSETS).forEach((name) => {
  hydrateCharacterImage(name).catch((error) => {
    console.error(`Unable to hydrate D character artwork: ${name}`, error);
  });
});

const revealElements = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );

  revealElements.forEach((element) => observer.observe(element));
} else {
  revealElements.forEach((element) => element.classList.add("visible"));
}

const lightbox = document.querySelector("#lightbox");
const lightboxImage = lightbox?.querySelector("img");
const closeButton = lightbox?.querySelector(".close");

document.querySelectorAll(".image-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (!lightbox || !lightboxImage || !button.dataset.image) return;
    lightboxImage.src = button.dataset.image;
    lightbox.showModal();
  });
});

closeButton?.addEventListener("click", () => lightbox?.close());
lightbox?.addEventListener("click", (event) => {
  if (event.target === lightbox) lightbox.close();
});
