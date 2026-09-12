const qualityGuardHref = "/lore/d/quality-guard.css";
if (!document.querySelector(`link[href="${qualityGuardHref}"]`)) {
  const qualityGuard = document.createElement("link");
  qualityGuard.rel = "stylesheet";
  qualityGuard.href = qualityGuardHref;
  document.head.append(qualityGuard);
}

// D artwork is emitted into the generated HTML as canonical, content-addressed
// R2 URLs before Next builds. Runtime JavaScript never reconstructs image bytes.
document.querySelectorAll("img[data-d-image]").forEach((image) => {
  image.addEventListener(
    "error",
    () => {
      console.error("D artwork failed to load", {
        id: image.dataset.dImage,
        src: image.currentSrc || image.src,
      });
    },
    { once: true },
  );
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
