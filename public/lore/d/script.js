const qualityGuardHref = "/lore/d/quality-guard.css";
if (!document.querySelector(`link[href="${qualityGuardHref}"]`)) {
  const qualityGuard = document.createElement("link");
  qualityGuard.rel = "stylesheet";
  qualityGuard.href = qualityGuardHref;
  document.head.append(qualityGuard);
}

// Primary artwork is already present as a normal binary URL in the generated HTML.
// JavaScript is only a resilience layer: if a primary image cannot decode, swap every
// occurrence of the same artwork to the build-materialized fallback file.
function useFallback(image) {
  const name = image.dataset.dImage;
  const fallback = image.dataset.fallbackImage;
  if (!name || !fallback || image.dataset.artworkQuality === "fallback") return;

  document.querySelectorAll(`[data-d-image="${name}"]`).forEach((element) => {
    element.dataset.artworkQuality = "fallback";
    if (element instanceof HTMLImageElement) {
      element.src = fallback;
    }
    if (element instanceof HTMLButtonElement) {
      element.dataset.image = fallback;
    }
  });
}

document.querySelectorAll("img[data-d-image]").forEach((image) => {
  image.addEventListener("error", () => useFallback(image), { once: true });
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
