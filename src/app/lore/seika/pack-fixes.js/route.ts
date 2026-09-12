export const dynamic = "force-static";

const BODY = `(() => {
  'use strict';
  if (window.__seikaPackFixesApplied) return;
  window.__seikaPackFixesApplied = true;

  const absenceCopy = document.querySelector('#ausencia .absence-copy');
  const absenceRevision = 'Não era só um professor faltando a uma visita. Era o quarto preparado em vão, as perguntas guardadas sem resposta e a primeira primavera em quase dez anos que parecia ter esquecido como terminar.';
  if (absenceCopy && !absenceCopy.textContent?.includes(absenceRevision)) {
    const paragraphs = absenceCopy.querySelectorAll('p');
    const anchor = paragraphs[paragraphs.length - 1];
    if (anchor) {
      const paragraph = document.createElement('p');
      paragraph.textContent = absenceRevision;
      anchor.insertAdjacentElement('afterend', paragraph);
    }
  }

  // Fragment-only links resolve against <base href="/lore/seika/">. Because the
  // public route is /lore/seika (without a trailing slash), native fragment
  // navigation can reload /lore/seika/#... and reset the page to Cinemático.
  // Keep reading navigation entirely in-page, matching the proven D fix.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('#seika-reading-view a[href^="#read-"]');
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

    history.replaceState(
      history.state,
      '',
      window.location.pathname + window.location.search + hash,
    );
  });
})();
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
