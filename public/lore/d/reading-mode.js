/* =========================================================
   Lore View Modes — Cinemático ⇄ Leitura
   ========================================================= */
const body = document.body;
const modeToggle = document.querySelector('#lore-mode-toggle');
const cinematicView = document.querySelector('[data-lore-view="cinematic"]');
const modeStatus = document.querySelector('#lore-mode-status');
const modeHint = document.querySelector('#mode-hint');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let readingView = null;
let readingPromise = null;
let currentMode = 'cinematic';
let chapterObserver = null;
let hintTimer = null;

const chapterIds = {
  'Prólogo — Sempre há um antes':'read-prologue','I — Antes de D':'read-before','II — Um futuro no bolso':'read-future','III — O último toque':'read-last-touch','IV — Os sinais':'read-signals','V — O pedido que nunca aconteceu':'read-proposal','VI — O erro dos homens':'read-men-error','VII — O disparo':'read-shot','VIII — “E se...?”':'read-what-if','IX — Ele não esqueceu':'read-memory','X — D.':'read-d','XI — Investigator':'read-investigator','XII — O homem que observa':'read-observer','XIII — Roupa fina. Vida bruta.':'read-wardrobe','XIV — O lenço':'read-scarf','XV — O sobretudo':'read-overcoat','XVI — O cachimbo':'read-pipe','XVII — O que restou do homem anterior':'read-remains','XVIII — Antes do “tarde demais”':'read-before-too-late','Epílogo — A resposta antes da pergunta':'read-epilogue'
};
const storyMap = [
  { cinematic: '.hero', reading: 'reading-top' },
  { cinematic: '#origem', reading: 'read-before' },
  { cinematic: '.proposal', reading: 'read-future' },
  { cinematic: '.night-copy', reading: 'read-signals' },
  { cinematic: '.crime-grid', reading: 'read-proposal' },
  { cinematic: '.death-scene', reading: 'read-shot' },
  { cinematic: '#e-se', reading: 'read-what-if' },
  { cinematic: '.aftermath', reading: 'read-memory' },
  { cinematic: '#proposito', reading: 'read-investigator' },
  { cinematic: '#perfil', reading: 'read-observer' },
  { cinematic: '#visual', reading: 'read-wardrobe' },
  { cinematic: '.relics', reading: 'read-scarf' },
  { cinematic: '.closing', reading: 'read-epilogue' },
];

function escapeHtml(value) { return value.replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }
function inlineMarkdown(value) {
  let text = escapeHtml(value);
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  return text;
}
function splitChapterTitle(title) {
  const parts = title.split(' — ');
  return parts.length > 1 ? [parts.shift(), parts.join(' — ')] : ['', title];
}
function parseLongform(markdown) {
  const clean = markdown.replace(/<!--[\s\S]*?-->/g, '').split('## Frases centrais para a apresentação editorial')[0];
  const lines = clean.split(/\r?\n/);
  const chapters = [];
  let current = null;
  let block = [];
  let quote = [];
  const flushParagraph = () => {
    if (!current || !block.length) return;
    current.blocks.push({ type:'p', text:block.join(' ') }); block=[];
  };
  const flushQuote = () => {
    if (!current || !quote.length) return;
    current.blocks.push({ type:'quote', lines:[...quote] }); quote=[];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const heading = line.match(/^(#{1,2})\s+(.+)$/);
    const isChapter = heading && (heading[2].startsWith('Prólogo') || /^(?:[IVXLCDM]+)\s+—/.test(heading[2]) || heading[2].startsWith('Epílogo'));
    if (isChapter) {
      flushParagraph(); flushQuote();
      current = { title:heading[2], id:chapterIds[heading[2]], blocks:[] };
      if (current.id) chapters.push(current); else current=null;
      continue;
    }
    if (!current) continue;
    if (!line) { flushParagraph(); flushQuote(); continue; }
    if (line === '---') { flushParagraph(); flushQuote(); continue; }
    if (line.startsWith('>')) { flushParagraph(); quote.push(line.replace(/^>\s?/,'')); continue; }
    flushQuote(); block.push(line);
  }
  flushParagraph(); flushQuote();
  return chapters;
}
function renderBlocks(blocks) {
  return blocks.map((block) => {
    if (block.type === 'quote') return `<blockquote>${block.lines.map((line) => `<p>${inlineMarkdown(line)}</p>`).join('')}</blockquote>`;
    return `<p>${inlineMarkdown(block.text)}</p>`;
  }).join('');
}
function readingFigure(id) {
  if (id === 'read-d') return '<figure class="reading-figure reading-figure-wide"><button class="image-button" data-image="https://media.dnd.faysk.dev/lore/d/726b86485d7488163545701a338c5b228273cbfc400bb7c7b72d96ae092d65c9/d-sem-sobretudo.png" aria-label="Ampliar retrato de D"><img src="https://media.dnd.faysk.dev/lore/d/726b86485d7488163545701a338c5b228273cbfc400bb7c7b72d96ae092d65c9/d-sem-sobretudo.png" alt="D em sua aparência atual, sem o sobretudo"></button><figcaption>D, depois. O homem que transformou atenção em método.</figcaption></figure>';
  if (id === 'read-wardrobe') return '<figure class="reading-figure"><button class="image-button" data-image="https://media.dnd.faysk.dev/lore/d/bdeeafe50820939245bf39fcd5c79e685fc6bffa4593d18c3d15f0ade6c7042d/d-sem-chapeu.png" aria-label="Ampliar retrato de D sem chapéu"><img src="https://media.dnd.faysk.dev/lore/d/bdeeafe50820939245bf39fcd5c79e685fc6bffa4593d18c3d15f0ade6c7042d/d-sem-chapeu.png" alt="D sem chapéu e sem sobretudo"></button><figcaption>Roupa fina. Vida bruta. A elegância permaneceu; o tempo fez o resto.</figcaption></figure>';
  return '';
}
function buildReadingView(markdown) {
  const chapters = parseLongform(markdown);
  if (!chapters.length) throw new Error('A história completa de D não contém capítulos reconhecíveis.');
  const nav = chapters.map(({title,id}) => { const [kicker,heading]=splitChapterTitle(title); return `<a href="#${id}" data-reading-link="${id}"><span>${escapeHtml(kicker || '•')}</span>${escapeHtml(heading)}</a>`; }).join('');
  const sections = chapters.map(({title,id,blocks}) => { const [kicker,heading]=splitChapterTitle(title); return `<section class="reading-chapter" id="${id}" data-reading-chapter><header class="reading-chapter-header"><p>${escapeHtml(kicker)}</p><h2>${escapeHtml(heading)}</h2></header><div class="reading-prose">${renderBlocks(blocks)}</div>${readingFigure(id)}</section>`; }).join('');
  const wordCount = chapters.reduce((total, chapter) => total + chapter.blocks.reduce((sum, block) => sum + (block.type === 'quote' ? block.lines.join(' ') : block.text).trim().split(/\s+/).filter(Boolean).length, 0), 0);
  const readingMinutes = Math.max(1, Math.round(wordCount / 220));
  const main = document.createElement('main');
  main.className='reading-view lore-view'; main.id='reading-view'; main.dataset.loreView='reading'; main.hidden=true;
  main.innerHTML=`<div class="reading-progress" aria-hidden="true"><span id="reading-progress-bar"></span></div><header class="reading-hero" id="reading-top"><div class="reading-hero-copy"><p class="eyebrow">HISTÓRIA COMPLETA · ≈ ${readingMinutes} MIN DE LEITURA</p><h1 class="reading-title shared-lore-title">D<span>.</span></h1><p class="reading-subtitle">Antes que seja <em>tarde demais.</em></p><p class="reading-deck">A história completa do homem que aprendeu a procurar o instante anterior ao irreversível.</p><a class="reading-start" href="#read-prologue">Começar a leitura <span aria-hidden="true">↓</span></a></div><div class="reading-hero-art"><div class="reading-halo" aria-hidden="true"></div><img class="shared-lore-art" src="https://media.dnd.faysk.dev/lore/d/30f853af30136239f0559cfe6e300949f6be1c0667cd4bd866e8c458eff01052/d-completo.png" alt="D usando sobretudo e chapéu, segurando um cachimbo"></div></header><div class="reading-layout"><aside class="reading-toc" aria-label="Capítulos da história completa"><p>Capítulos</p><nav>${nav}</nav></aside><article class="reading-document" aria-label="História completa de D"><details class="reading-mobile-toc"><summary>Capítulos <span aria-hidden="true">＋</span></summary><nav>${nav}</nav></details>${sections}</article></div>`;
  document.querySelector('footer').before(main); setupReadingNavigation(main); return main;
}
async function ensureReadingView() {
  if (readingView) return readingView;
  if (!readingPromise) {
    const storyParts = ['/lore/d/historia-1.md','/lore/d/historia-2.md','/lore/d/historia-3.md','/lore/d/historia-4.md'];
    readingPromise = Promise.all(storyParts.map((url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Falha ao carregar história completa: ${response.status}`);
      return response.text();
    }))).then((parts) => parts.join('\n')).then((markdown) => {
      readingView=buildReadingView(markdown);
      return readingView;
    });
  }
  return readingPromise;
}

function nearestCinematicEntry() {
  const headerOffset=100; let best=storyMap[0], bestDistance=Infinity;
  storyMap.forEach((entry) => { const element=document.querySelector(entry.cinematic); if(!element)return; const rect=element.getBoundingClientRect(); const distance=rect.bottom<headerOffset?Math.abs(rect.bottom-headerOffset)+180:Math.abs(rect.top-headerOffset); if(distance<bestDistance){bestDistance=distance;best=entry;} });
  return best;
}
function nearestReadingEntry() {
  const hero=readingView?.querySelector('.reading-hero'); if(hero && window.scrollY < hero.offsetTop + hero.offsetHeight*.72) return storyMap[0];
  const chapters=[...document.querySelectorAll('[data-reading-chapter]')]; const headerOffset=110; let active=chapters[0], bestDistance=Infinity;
  chapters.forEach((chapter)=>{const rect=chapter.getBoundingClientRect();const distance=rect.bottom<headerOffset?Math.abs(rect.bottom-headerOffset)+180:Math.abs(rect.top-headerOffset);if(distance<bestDistance){bestDistance=distance;active=chapter;}});
  const activeIndex=chapters.indexOf(active); let best=null;
  storyMap.forEach((item)=>{const target=document.getElementById(item.reading);const targetIndex=chapters.indexOf(target);if(targetIndex<0||activeIndex<0)return;const distance=Math.abs(targetIndex-activeIndex);if(!best||distance<best.distance)best={item,distance};});
  return best?best.item:storyMap[0];
}
function setToggleState(mode) {
  const reading=mode==='reading'; body.dataset.loreMode=mode; modeToggle.setAttribute('aria-checked',String(reading)); modeToggle.setAttribute('aria-label',reading?'Ativar modo Cinemático':'Ativar modo Leitura'); modeToggle.title=reading?'Modo Leitura — trocar para Cinemático':'Modo Cinemático — trocar para Leitura'; if(modeStatus) modeStatus.textContent=reading?'Modo Leitura ativo.':'Modo Cinemático ativo.';
}
function jumpTo(element){ if(!element)return; element.scrollIntoView({block:'start',behavior:'auto'}); }
function swapView(nextMode,entry){ if(nextMode==='reading'){cinematicView.hidden=true;readingView.hidden=false;setToggleState('reading');jumpTo(document.getElementById(entry.reading)||readingView.querySelector('#reading-top'));updateReadingProgress();}else{readingView.hidden=true;cinematicView.hidden=false;setToggleState('cinematic');jumpTo(document.querySelector(entry.cinematic)||cinematicView);}currentMode=nextMode; }
async function changeMode(nextMode) {
  if(nextMode===currentMode||body.classList.contains('is-switching'))return; hideModeHint(); body.classList.add('is-switching'); modeToggle.setAttribute('aria-busy','true');
  try { if(nextMode==='reading') await ensureReadingView(); const entry=currentMode==='cinematic'?nearestCinematicEntry():nearestReadingEntry(); if(!reduceMotion.matches&&document.startViewTransition){const transition=document.startViewTransition(()=>swapView(nextMode,entry));await transition.finished;}else swapView(nextMode,entry); }
  catch(error){console.error(error);if(modeStatus) modeStatus.textContent='Não foi possível abrir o modo Leitura.';}
  finally{body.classList.remove('is-switching');modeToggle.removeAttribute('aria-busy');modeToggle.focus({preventScroll:true});}
}
modeToggle.addEventListener('click',()=>changeMode(currentMode==='cinematic'?'reading':'cinematic')); setToggleState('cinematic');
document.querySelector('.brand').addEventListener('click',(event)=>{event.preventDefault();window.scrollTo({top:0,behavior:reduceMotion.matches?'auto':'smooth'});});

function setupReadingNavigation(view) {
  const chapters=[...view.querySelectorAll('[data-reading-chapter]')],tocLinks=[...view.querySelectorAll('[data-reading-link]')]; chapterObserver?.disconnect(); chapterObserver=new IntersectionObserver((entries)=>{const visible=entries.filter((entry)=>entry.isIntersecting).sort((a,b)=>Math.abs(a.boundingClientRect.top-130)-Math.abs(b.boundingClientRect.top-130));if(!visible.length)return;const id=visible[0].target.id;tocLinks.forEach((link)=>link.classList.toggle('active',link.dataset.readingLink===id));},{rootMargin:'-18% 0px -68% 0px',threshold:0});chapters.forEach((chapter)=>chapterObserver.observe(chapter));view.addEventListener('click',(event)=>{const link=event.target.closest('[data-reading-link]');if(!link)return;const mobileToc=link.closest('details');if(mobileToc)mobileToc.open=false;});
}
function updateReadingProgress(){if(currentMode!=='reading'||!readingView)return;const bar=readingView.querySelector('#reading-progress-bar');if(!bar)return;const start=readingView.offsetTop,end=start+readingView.scrollHeight-window.innerHeight,progress=end<=start?1:Math.min(1,Math.max(0,(window.scrollY-start)/(end-start)));bar.style.width=`${progress*100}%`;}
window.addEventListener('scroll',updateReadingProgress,{passive:true}); window.addEventListener('resize',updateReadingProgress,{passive:true});

function hideModeHint(){if(!modeHint||modeHint.hidden)return;modeHint.hidden=true;if(hintTimer)clearTimeout(hintTimer);try{sessionStorage.setItem('lore-d-mode-hint-seen','1');}catch(_){}}
try{if(modeHint&&!sessionStorage.getItem('lore-d-mode-hint-seen')){window.setTimeout(()=>{if(currentMode!=='cinematic')return;modeHint.hidden=false;hintTimer=window.setTimeout(hideModeHint,6500);},2600);}}catch(_){}
modeHint?.addEventListener('click',hideModeHint);

// As imagens do modo Leitura são criadas depois do carregamento inicial,
// então o lightbox cinematográfico não as conhece. Delegamos apenas esses cliques.
const readingLightbox = document.querySelector('#lightbox');
const readingLightboxImg = readingLightbox?.querySelector('img');
document.addEventListener('click', (event) => {
  const button = event.target.closest('#reading-view .image-button');
  if (!button || !readingLightbox || !readingLightboxImg) return;
  readingLightboxImg.src = button.dataset.image;
  readingLightboxImg.alt = button.querySelector('img')?.alt || 'Imagem ampliada de D';
  if (!readingLightbox.open) readingLightbox.showModal();
});

// Preload the long-form source during idle time so the first switch feels immediate.
const preloadReading=()=>ensureReadingView().catch((error)=>console.error(error));
if('requestIdleCallback' in window) requestIdleCallback(preloadReading,{timeout:1800}); else window.setTimeout(preloadReading,900);
