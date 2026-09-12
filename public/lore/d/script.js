const qualityGuardHref = "/lore/d/quality-guard.css";
if (!document.querySelector(`link[href="${qualityGuardHref}"]`)) {
  const qualityGuard = document.createElement("link");
  qualityGuard.rel = "stylesheet";
  qualityGuard.href = qualityGuardHref;
  document.head.append(qualityGuard);
}

// Browser delivery is intentionally simple: the build materializes the repository's
// transport-only base64 payloads into real image files before Next starts. The browser
// never downloads .b64 files and never constructs large data: URLs at runtime.
const ASSETS = {
  "d-completo": {
    primary: "/lore/d/assets/generated/d-completo.avif",
    fallback: "/lore/d/assets/generated/d-completo-fallback.png",
  },
  "d-sem-sobretudo": {
    primary: "/lore/d/assets/generated/d-sem-sobretudo.avif",
    fallback: "/lore/d/assets/generated/d-sem-sobretudo-fallback.avif",
  },
  "d-sem-chapeu": {
    primary: "/lore/d/assets/generated/d-sem-chapeu.avif",
    fallback: "/lore/d/assets/generated/d-sem-chapeu-fallback.png",
  },
};

function applyCharacterImage(name, url, quality) {
  document.querySelectorAll(`[data-d-image="${name}"]`).forEach((element) => {
    element.dataset.artworkQuality = quality;
    if (element instanceof HTMLImageElement) element.src = url;
    if (element instanceof HTMLButtonElement) element.dataset.image = url;
  });
}

function bindCharacterImage(name) {
  const asset = ASSETS[name];
  if (!asset) return;

  document.querySelectorAll(`img[data-d-image="${name}"]`).forEach((image) => {
    image.addEventListener(
      "error",
      () => {
        if (image.dataset.artworkQuality === "fallback") return;
        console.warn(`Primary artwork failed for ${name}; using stable fallback`);
        applyCharacterImage(name, asset.fallback, "fallback");
      },
      { once: true },
    );
  });

  applyCharacterImage(name, asset.primary, "hq");
}

Object.keys(ASSETS).forEach(bindCharacterImage);

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
