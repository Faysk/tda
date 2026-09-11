const qualityGuardHref = "/lore/d/quality-guard.css";
if (!document.querySelector(`link[href="${qualityGuardHref}"]`)) {
  const qualityGuard = document.createElement("link");
  qualityGuard.rel = "stylesheet";
  qualityGuard.href = qualityGuardHref;
  document.head.append(qualityGuard);
}

const ASSETS = {
  "d-completo": {
    mime: "image/avif",
    path: "/lore/d/assets/d-completo-hq.avif.b64",
  },
  "d-sem-sobretudo": {
    mime: "image/avif",
    path: "/lore/d/assets/d-sem-sobretudo-hq.avif.b64",
  },
  "d-sem-chapeu": {
    mime: "image/avif",
    path: "/lore/d/assets/d-sem-chapeu-hq.avif.b64",
  },
};

function applyCharacterImage(name, url) {
  document.querySelectorAll(`[data-d-image="${name}"]`).forEach((element) => {
    if (element instanceof HTMLImageElement) element.src = url;
    if (element instanceof HTMLButtonElement) element.dataset.image = url;
  });
}

async function hydrateCharacterImage(name) {
  const asset = ASSETS[name];
  if (!asset) return;

  const response = await fetch(asset.path, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Failed to load ${asset.path}: ${response.status}`);

  const base64 = (await response.text()).replace(/\s+/g, "");
  if (!base64) throw new Error(`Empty artwork payload: ${asset.path}`);

  applyCharacterImage(name, `data:${asset.mime};base64,${base64}`);
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
