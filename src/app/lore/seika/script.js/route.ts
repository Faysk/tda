export const dynamic = "force-static";

const BODY = `(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
  const progressBar = document.getElementById('progressBar');
  const siteChrome = document.getElementById('siteChrome');
  const menuToggle = document.getElementById('menuToggle');
  const chapterNav = document.getElementById('chapterNav');
  const seasonIndicator = document.getElementById('seasonIndicator');
  const seasonLabels = [...document.querySelectorAll('[data-season-label]')];
  const navLinks = [...document.querySelectorAll('.chapter-nav a')];
  const observedScenes = [...document.querySelectorAll('.scene-observer')];
  const departure = document.getElementById('partida');
  const departurePan = document.getElementById('departurePan');
  const departureLines = [...document.querySelectorAll('[data-departure-line]')];

  const seasonMap = { memoria: 0, primavera: 1 / 3, verao: 2 / 3, inverno: 1 };
  let activeChapter = 'topo';
  let activeSeason = 'memoria';
  let ticking = false;

  function setSeason(season) {
    if (!season || season === activeSeason) return;
    activeSeason = season;
    const y = seasonMap[season] ?? 0;
    if (seasonIndicator) seasonIndicator.style.top = \`calc(\${y * 100}% - \${y * 7}px)\`;
    seasonLabels.forEach((label) => label.classList.toggle('active', label.dataset.seasonLabel === season));
  }

  function setChapter(chapter) {
    if (!chapter || chapter === activeChapter) return;
    activeChapter = chapter;
    navLinks.forEach((link) => {
      const target = link.getAttribute('href')?.slice(1);
      link.classList.toggle('active', target === chapter);
    });
  }

  function scrollState() {
    ticking = false;
    const doc = document.documentElement;
    const scrollMax = Math.max(1, doc.scrollHeight - window.innerHeight);
    const p = clamp(window.scrollY / scrollMax);
    if (progressBar) progressBar.style.transform = \`scaleX(\${p})\`;
    siteChrome?.classList.toggle('scrolled', window.scrollY > 24);

    if (departure && departurePan) {
      const rect = departure.getBoundingClientRect();
      const travel = Math.max(1, departure.offsetHeight - window.innerHeight);
      const dp = clamp((-rect.top) / travel);
      departure.style.setProperty('--depart-progress', dp.toFixed(4));
      const lineIndex = dp < .22 ? 0 : dp < .44 ? 1 : dp < .66 ? 2 : 3;
      departureLines.forEach((line, i) => line.classList.toggle('active', i === lineIndex));
    }

    if (!reducedMotion) {
      document.querySelectorAll('.parallax-bg').forEach((el) => {
        const rect = el.parentElement?.getBoundingClientRect();
        if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) return;
        const speed = Number(el.dataset.speed || .04);
        const local = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
        const shift = (local - .5) * window.innerHeight * speed;
        el.style.transform = \`translate3d(0, \${shift}px, 0) scale(1.04)\`;
      });
    }
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(scrollState);
    }
  }, { passive: true });
  window.addEventListener('resize', scrollState, { passive: true });
  scrollState();

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: .12, rootMargin: '0px 0px -7% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

  const sceneObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    setSeason(visible.target.dataset.season);
    setChapter(visible.target.dataset.chapter);
  }, { threshold: [.18, .35, .55], rootMargin: '-18% 0px -42% 0px' });
  observedScenes.forEach((scene) => sceneObserver.observe(scene));
  seasonLabels[0]?.classList.add('active');

  menuToggle?.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(open));
    chapterNav?.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open && window.innerWidth <= 1100);
  });
  navLinks.forEach((link) => link.addEventListener('click', () => {
    menuToggle?.setAttribute('aria-expanded', 'false');
    chapterNav?.classList.remove('open');
    document.body.classList.remove('menu-open');
  }));

  if (!reducedMotion) {
    document.querySelectorAll('[data-tilt-scene]').forEach((scene) => {
      const layers = [...scene.querySelectorAll('.parallax-layer')];
      scene.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch') return;
        const rect = scene.getBoundingClientRect();
        const nx = ((event.clientX - rect.left) / rect.width - .5) * 2;
        const ny = ((event.clientY - rect.top) / rect.height - .5) * 2;
        layers.forEach((layer) => {
          const depth = Number(layer.dataset.depth || .08);
          layer.style.transform = \`translate3d(\${nx * depth * 28}px, \${ny * depth * 22}px, 0) scale(\${1.025 + depth * .03})\`;
        });
      });
      scene.addEventListener('pointerleave', () => {
        layers.forEach((layer) => { layer.style.transform = ''; });
      });
    });

    const hero = document.querySelector('.hero');
    const heroLayers = hero ? [...hero.querySelectorAll('.parallax-layer')] : [];
    hero?.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const rect = hero.getBoundingClientRect();
      const nx = ((event.clientX - rect.left) / rect.width - .5) * 2;
      const ny = ((event.clientY - rect.top) / rect.height - .5) * 2;
      heroLayers.forEach((layer) => {
        const depth = Number(layer.dataset.depth || .05);
        layer.style.transform = \`translate3d(\${nx * depth * 30}px, \${ny * depth * 18}px, 0) scale(\${1 + depth * .015})\`;
      });
    });
    hero?.addEventListener('pointerleave', () => heroLayers.forEach((layer) => { layer.style.transform = ''; }));
  }

  const particles = document.getElementById('ritualParticles');
  if (particles && !reducedMotion) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 26; i += 1) {
      const p = document.createElement('i');
      p.className = 'spirit-particle';
      p.style.left = \`\${4 + Math.random() * 83}%\`;
      p.style.top = \`\${25 + Math.random() * 65}%\`;
      p.style.setProperty('--dur', \`\${5.5 + Math.random() * 6}s\`);
      p.style.setProperty('--delay', \`\${-Math.random() * 8}s\`);
      p.style.setProperty('--drift', \`\${-55 + Math.random() * 110}px\`);
      fragment.appendChild(p);
    }
    particles.appendChild(fragment);
  }

  const investigation = document.querySelector('[data-investigation]');
  const investigationCopy = document.getElementById('investigationCopy');
  const methodCopy = {
    observar: ['Primeiro: o fenômeno.', 'Objetos mudavam de lugar, portas abriam e passos apareciam depois que todos já haviam ido dormir.'],
    escutar: ['Depois: o vínculo.', 'A presença era real, mas não era maligna. Estava ligada a um objeto antigo que havia sido deslocado ou esquecido.'],
    resolver: ['Por fim: o cuidado.', 'Incenso, símbolos, atenção. O espírito conseguiu partir e a taverna voltou ao normal — sem violência.']
  };
  investigation?.querySelectorAll('[data-method]').forEach((button) => {
    button.addEventListener('click', () => {
      investigation.querySelectorAll('[data-method]').forEach((b) => {
        const active = b === button;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });
      if (!investigationCopy) return;
      const [title, text] = methodCopy[button.dataset.method] || methodCopy.observar;
      investigationCopy.style.opacity = '0';
      setTimeout(() => {
        investigationCopy.innerHTML = \`<strong>\${title}</strong><p>\${text}</p>\`;
        investigationCopy.style.opacity = '1';
      }, reducedMotion ? 0 : 170);
    });
  });

  const lightbox = document.getElementById('lightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxClose = document.getElementById('lightboxClose');
  document.querySelectorAll('.archive-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (!lightbox || !lightboxImage || !lightboxCaption) return;
      const img = item.querySelector('img');
      lightboxImage.src = item.dataset.full || img?.src || '';
      lightboxImage.alt = img?.alt || '';
      lightboxCaption.textContent = item.querySelector('span')?.textContent || '';
      if (typeof lightbox.showModal === 'function') lightbox.showModal();
    });
  });
  lightboxClose?.addEventListener('click', () => lightbox?.close());
  lightbox?.addEventListener('click', (event) => {
    if (event.target === lightbox) lightbox.close();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && lightbox?.open) lightbox.close();
  });

  document.querySelectorAll('[data-panorama]').forEach((figure) => {
    const o = new IntersectionObserver((entries) => {
      entries.forEach((entry) => entry.target.classList.toggle('visible', entry.isIntersecting));
    }, { threshold: .3 });
    o.observe(figure);
  });
})();
`;

export function GET() {
 return new Response(BODY, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=3600" } });
}
