const qualityGuardHref = "/lore/d/quality-guard.css";
if (!document.querySelector(`link[href="${qualityGuardHref}"]`)) {
  const qualityGuard = document.createElement("link");
  qualityGuard.rel = "stylesheet";
  qualityGuard.href = qualityGuardHref;
  document.head.append(qualityGuard);
}

const ASSET_CHUNKS = {
  "d-completo": {
    mime: "image/png",
    paths: [
      "/lore/d/assets/base64/d-completo-fixed.0.b64",
      "/lore/d/assets/base64/d-completo-fixed.1.b64",
      "/lore/d/assets/base64/d-completo-fixed.2.b64",
    ],
  },
  "d-sem-sobretudo": {
    mime: "image/avif",
    paths: [
      "/lore/d/assets/base64/d-sem-sobretudo.0.b64",
      "/lore/d/assets/base64/d-sem-sobretudo.1.b64",
      "/lore/d/assets/base64/d-sem-sobretudo.2.b64",
    ],
  },
  "d-sem-chapeu": {
    mime: "image/png",
    paths: [
      "/lore/d/assets/base64/d-sem-chapeu-fixed.0.b64",
      "/lore/d/assets/base64/d-sem-chapeu-fixed.1.b64",
      "/lore/d/assets/base64/d-sem-chapeu-fixed.2.b64",
    ],
  },
};

function applyCharacterImage(name, url) {
  document.querySelectorAll(`[data-d-image="${name}"]`).forEach((element) => {
    if (element instanceof HTMLImageElement) element.src = url;
    if (element instanceof HTMLButtonElement) element.dataset.image = url;
  });
}

async function hydrateCharacterImage(name) {
  const asset = ASSET_CHUNKS[name];
  if (!asset) return;

  const parts = await Promise.all(
    asset.paths.map(async (path) => {
      const response = await fetch(path, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
      return (await response.text()).trim();
    }),
  );

  applyCharacterImage(name, `data:${asset.mime};base64,${parts.join("")}`);
}

Promise.all(Object.keys(ASSET_CHUNKS).map(hydrateCharacterImage)).catch((error) => {
  console.error("Unable to hydrate D character artwork", error);
});

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

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));

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
