// Keep D's tab identity scoped to this lore. The SVG stays crisp at favicon
// sizes and resolves against <base href="/lore/d/"> as /lore/d/favicon.svg.
if (!document.querySelector('link[rel~="icon"][href$="favicon.svg"]')) {
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/svg+xml';
  favicon.href = 'favicon.svg';
  document.head.append(favicon);
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

const lightbox = document.querySelector('#lightbox');
const lightboxImg = lightbox.querySelector('img');
const closeBtn = lightbox.querySelector('.close');

document.querySelectorAll('.image-button').forEach((button) => {
  button.addEventListener('click', () => {
    lightboxImg.src = button.dataset.image;
    lightboxImg.alt = button.querySelector('img')?.alt || '';
    lightbox.showModal();
  });
});

closeBtn.addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', (event) => {
  const rect = lightbox.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) lightbox.close();
});

// Fragment-only links resolve against <base href="/lore/d/">. When the public
// route is /lore/d (without the trailing slash), the browser treats that as a
// navigation to /lore/d/#... and reloads the document, which resets the page
// back to Cinemático. Keep reading navigation entirely in-page instead.
document.addEventListener('click', (event) => {
  const link = event.target.closest('#reading-view a[href^="#read-"]');
  if (!link || document.body.dataset.loreMode !== 'reading') return;

  const hash = link.getAttribute('href');
  const target = hash ? document.querySelector(hash) : null;
  if (!target) return;

  event.preventDefault();

  const mobileIndex = link.closest('details');
  if (mobileIndex) mobileIndex.open = false;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({
    block: 'start',
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
  });

  // Preserve the canonical path exactly as loaded while exposing the chapter
  // in the URL for back/forward/history without triggering a navigation.
  history.replaceState(
    history.state,
    '',
    `${window.location.pathname}${window.location.search}${hash}`,
  );
});
