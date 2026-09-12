const qualityGuardHref = "/lore/d/quality-guard.css";
if (!document.querySelector(`link[href="${qualityGuardHref}"]`)) {
  const qualityGuard = document.createElement("link");
  qualityGuard.rel = "stylesheet";
  qualityGuard.href = qualityGuardHref;
  document.head.append(qualityGuard);
}

const ASSETS = {
  "d-completo": "/lore/d/assets/web/d-completo.png",
  "d-sem-sobretudo": "/lore/d/assets/web/d-sem-sobretudo.png",
  "d-sem-chapeu": "/lore/d/assets/web/d-sem-chapeu.png",
};

function applyCharacterImage(name, url) {
  document.querySelectorAll(`[data-d-image="${name}"]`).forEach((element) => {
    element.dataset.artworkQuality = "r2-original";
    if (element instanceof HTMLImageElement) {
      element.src = url;
      element.decoding = "async";
    }
    if (element instanceof HTMLButtonElement) element.dataset.image = url;
  });
}

Object.entries(ASSETS).forEach(([name, url]) => applyCharacterImage(name, url));

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
