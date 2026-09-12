export const dynamic = "force-static";

const BODY = `<!doctype html>
<html lang="pt-BR">
<head>
<base href="/lore/seika/" />
<link rel="canonical" href="https://dnd.faysk.dev/lore/seika" />
<meta property="og:url" content="https://dnd.faysk.dev/lore/seika" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="https://media.dnd.faysk.dev/lore/seika/74cf3cdab85ed37eac4a28276864449b9101716e63202ae32a9c314e299793b5/wide-departure-full.webp" />
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#17130f" />
  <meta name="description" content="Seika — Antes do Inverno. Uma experiência narrativa sobre casa, cuidado, sorte, espíritos e a estrada que começa no verão." />
  <meta property="og:title" content="Seika — Antes do Inverno" />
  <meta property="og:description" content="Uma história sobre cuidado, casa e a estrada que começa quando alguém não volta." />
  <meta property="og:image" content="https://media.dnd.faysk.dev/lore/seika/74cf3cdab85ed37eac4a28276864449b9101716e63202ae32a9c314e299793b5/wide-departure-full.webp" />
  <title>Seika — Antes do Inverno</title>
  <link rel="icon" href="seika-mark.svg" type="image/svg+xml" />
  <link rel="preload" as="image" href="https://media.dnd.faysk.dev/lore/seika/2e223c08e8b273dec7a27e114a37e89f3039f108f64787ab1a17d3df4acdccc6/wide-ink-moon.webp" fetchpriority="high" />
  <link rel="preload" as="image" href="https://media.dnd.faysk.dev/lore/seika/ae5e52eaba48fdb16364289a6e5b9e1d9c952142a0b2a67d56b7303f9af01a9d/adult-seika-subject-spirit.webp" fetchpriority="high" />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <a class="skip-link" href="#historia">Pular para a história</a>

  <div class="reading-progress" aria-hidden="true"><span id="progressBar"></span></div>
  <div class="paper-grain" aria-hidden="true"></div>
  <div class="vignette" aria-hidden="true"></div>

  <header class="site-chrome" id="siteChrome">
    <a class="brand" href="#topo" aria-label="Seika — voltar ao início">
      <span class="brand-mark" aria-hidden="true">◐</span>
      <span>SEIKA</span>
    </a>
    <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="chapterNav">
      <span></span><span></span><span></span><span class="sr-only">Abrir capítulos</span>
    </button>
    <nav class="chapter-nav" id="chapterNav" aria-label="Capítulos">
      <a href="#casa">Casa</a>
      <a href="#lucky">Lucky</a>
      <a href="#ami">Ami</a>
      <a href="#ren">Ren</a>
      <a href="#primeiro-exorcismo">Primeiro exorcismo</a>
      <a href="#ausencia">A primavera</a>
      <a href="#partida">Partida</a>
      <a href="#caderno">Caderno</a>
    </nav>
  </header>

  <aside class="season-rail" aria-label="Relógio da história">
    <div class="season-line" aria-hidden="true"><i id="seasonIndicator"></i></div>
    <div class="season-labels">
      <span data-season-label="memoria">memória</span>
      <span data-season-label="primavera">primavera</span>
      <span data-season-label="verao">verão</span>
      <span data-season-label="inverno">inverno</span>
    </div>
  </aside>

  <main id="historia">
    <section class="hero scene-observer" id="topo" data-season="memoria" data-chapter="topo">
      <div class="hero-ink parallax-layer" data-depth="0.08" aria-hidden="true">
        <img src="https://media.dnd.faysk.dev/lore/seika/2e223c08e8b273dec7a27e114a37e89f3039f108f64787ab1a17d3df4acdccc6/wide-ink-moon.webp" alt="" fetchpriority="high" />
      </div>
      <div class="hero-haze" aria-hidden="true"></div>
      <div class="hero-spirit-glow" aria-hidden="true"></div>
      <div class="hero-character parallax-layer" data-depth="0.22" aria-hidden="true">
        <img src="https://media.dnd.faysk.dev/lore/seika/ae5e52eaba48fdb16364289a6e5b9e1d9c952142a0b2a67d56b7303f9af01a9d/adult-seika-subject-spirit.webp" alt="" fetchpriority="high" />
      </div>
      <div class="hero-copy reveal reveal-now">
        <p class="eyebrow">Catfolk · Oracle · Mistério da Vida</p>
        <h1>SEIKA</h1>
        <p class="hero-subtitle">Antes do <em>Inverno</em></p>
        <div class="hero-rule"><span></span><i>✦</i><span></span></div>
        <p class="hero-thesis">Ele não se considera um aventureiro.</p>
        <p class="hero-thesis hero-thesis-strong">Está apenas procurando um amigo.</p>
        <a class="scroll-cta" href="#casa"><span>desenrolar a história</span><b aria-hidden="true">↓</b></a>
      </div>
      <div class="hero-meta" aria-hidden="true">
        <span>23 anos</span>
        <span>herbalista</span>
        <span>exorcista iniciante</span>
      </div>
    </section>

    <section class="chapter warm scene-observer" id="casa" data-season="memoria" data-chapter="casa">
      <div class="panorama panorama-village parallax-bg" data-speed="0.06" aria-hidden="true"></div>
      <div class="chapter-shade"></div>
      <div class="story-frame story-frame-left reveal">
        <p class="chapter-kicker">I · Casa</p>
        <h2>Uma vida pequena.<br><span>Simples. Boa.</span></h2>
        <p>Seika nasceu numa vila onde quase todos se conhecem — quem planta, quem cozinha, quem conserta ferramentas e quem esquece a mesma janela aberta antes da chuva.</p>
        <p>Ele cresceu entre o cheiro de ervas secando, pequenos remédios, vizinhos aparecendo à porta e duas lições que acabariam seguindo com ele muito além da botica.</p>
        <div class="two-lessons" aria-label="As duas lições de Seika">
          <blockquote><small>Haru</small><strong>Observe antes de tocar.</strong></blockquote>
          <blockquote><small>Mei</small><strong>Escute antes de tratar.</strong></blockquote>
        </div>
      </div>
      <div class="world-note reveal" role="note">
        <span>casa</span>
        <p>O sobrenatural viria depois. Primeiro, Seika aprendeu a cuidar.</p>
      </div>
    </section>

    <section class="chapter parchment scene-observer" id="lucky" data-season="memoria" data-chapter="lucky">
      <div class="section-heading reveal">
        <p class="chapter-kicker">II · Lucky</p>
        <h2>Uma sorte que parecia<br><em>boa demais.</em></h2>
        <p class="lede">Pequenos desastres aconteciam ao redor de Seika. O estranho era como quase sempre terminavam bem.</p>
      </div>

      <div class="layered-scene lucky-scene" data-tilt-scene>
        <div class="layered-back parallax-layer" data-depth="0.05">
          <img src="https://media.dnd.faysk.dev/lore/seika/54afc25a18ee299a3249baa9d2dc403076ec2961bbf8f96eb5cfc36a063335d4/lucky-background.webp" alt="Ruínas antigas cobertas por vegetação, com uma cobra junto a uma pedra caída." loading="lazy" />
        </div>
        <div class="layered-subject parallax-layer" data-depth="0.16">
          <img src="https://media.dnd.faysk.dev/lore/seika/5768c8b4c277ae7bb056799b75d2f21e0de020152a1fc0b83630e6b81bdedeba/lucky-subject.webp" alt="Seika ainda criança, assustado após escapar por pouco de um acidente nas ruínas." loading="lazy" />
        </div>
        <div class="scene-light" aria-hidden="true"></div>
        <div class="scene-caption reveal">
          <span class="memory-index">memória 01</span>
          <h3>A pedra errou Seika.</h3>
          <p>E esmagou a cobra que estava prestes a atacá-lo.</p>
        </div>
      </div>

      <div class="lucky-ledger">
        <div class="luck-examples reveal">
          <span>perdeu-se na floresta</span><b>→</b><strong>encontrou um caminho antigo</strong>
          <span>escorregou de uma árvore</span><b>→</b><strong>caiu sobre folhas</strong>
          <span>seguiu a direção errada</span><b>→</b><strong>voltou com uma planta rara</strong>
        </div>
        <blockquote class="quote-card reveal">
          <p>“Sorte é só o nome que damos para alguma coisa quando ainda não entendemos por que aconteceu.”</p>
          <cite>— Haru</cite>
        </blockquote>
      </div>

      <figure class="cinematic-strip reveal" data-panorama>
        <img src="https://media.dnd.faysk.dev/lore/seika/a02d6f1ccc772a78f130113b2a7edda88bd0dfbb422be651a75390f8cbcfc7ad/wide-lucky-full.webp" alt="Seika criança nas ruínas, diante da cobra e da pedra caída, em composição panorâmica." loading="lazy" />
        <figcaption><span>Lucky</span> O apelido ficou. A explicação, não.</figcaption>
      </figure>

      <div class="detour-note reveal">
        <p>Haru podia mandá-lo buscar uma erva ao norte. Horas depois, Seika voltava pelo sul, coberto de lama, com duas plantas diferentes e alguma pessoa que encontrou precisando de ajuda.</p>
        <strong>“Seika. Vá direto.”</strong>
        <small>Quando uma entrega era realmente urgente, a vila aprendeu a especificar.</small>
      </div>
    </section>

    <section class="philosophy-bridge scene-observer" data-season="memoria" aria-labelledby="filosofia-titulo">
      <div class="botanical-veil" aria-hidden="true"></div>
      <div class="philosophy-copy reveal">
        <p class="eyebrow">O método veio antes da magia</p>
        <h2 id="filosofia-titulo">Observar. Escutar.<br><span>Só então agir.</span></h2>
        <p>Mais tarde, Seika levaria o mesmo princípio do herbalismo para aquilo que ervas sozinhas não conseguiam tratar.</p>
      </div>
      <div class="method-triad" aria-label="Método de Seika">
        <article class="reveal"><b>01</b><h3>Observar</h3><p>O que mudou? O que não pertence ali? O que as pessoas deixaram de perceber?</p></article>
        <article class="reveal"><b>02</b><h3>Escutar</h3><p>Medo, espírito ou pessoa: antes de decidir, entender o que está tentando ser dito.</p></article>
        <article class="reveal"><b>03</b><h3>Cuidar</h3><p>Nem tudo precisa ser destruído. Algumas coisas estão confusas. Algumas estão presas.</p></article>
      </div>
    </section>

    <section class="chapter ritual scene-observer" id="ami" data-season="memoria" data-chapter="ami">
      <div class="ritual-particles" id="ritualParticles" aria-hidden="true"></div>
      <div class="section-heading section-heading-light reveal">
        <p class="chapter-kicker">III · Ami</p>
        <h2>O primeiro contato<br><em>real</em> com o sobrenatural.</h2>
      </div>

      <div class="layered-scene ritual-scene" data-tilt-scene>
        <div class="layered-back parallax-layer" data-depth="0.04">
          <img src="https://media.dnd.faysk.dev/lore/seika/943f29f9b616f14630514d784d9d46b29a4a65cf2925dfdcb06e8201a1db7181/ritual-background-ami-ren.webp" alt="Ami sentada no chão e Ren ferido durante um ritual em uma sala de madeira iluminada por lanternas." loading="lazy" />
        </div>
        <div class="layered-subject spectral-layer parallax-layer" data-depth="0.18">
          <img src="https://media.dnd.faysk.dev/lore/seika/dc62be5a52882cac6cbe01f91bfa024da7246e8f39551412372a0e36a069e4b7/ritual-subject-spirit.webp" alt="Seika adolescente diante de uma manifestação espiritual felina violeta durante o ritual de Ami." loading="lazy" />
        </div>
        <div class="ritual-aura" aria-hidden="true"></div>
        <div class="scene-caption scene-caption-dark reveal">
          <span class="memory-index">13 anos</span>
          <h3>Outras pessoas recuaram.</h3>
          <p>Seika não ficou porque não sentia medo. Ficou porque não conseguia aceitar deixar Ami sozinha.</p>
        </div>
      </div>

      <div class="answered-moment reveal">
        <p>Uma parte do ritual falhou.</p>
        <p>Seika tentou ajudar.</p>
        <strong>E alguma coisa respondeu.</strong>
        <small>O que exatamente aconteceu permanece sem resposta.</small>
      </div>

      <figure class="cinematic-strip cinematic-strip-night reveal" data-panorama>
        <img src="https://media.dnd.faysk.dev/lore/seika/8ef2730e025f01bb6ae59dffdcfad1994a4835cd4e43d574cd35e1c02fda0b16/wide-ami-ritual-full.webp" alt="Ritual de Ami em panorama: Seika, Ami, Ren e uma grande presença espiritual violeta." loading="lazy" />
        <figcaption><span>O ritual de Ami</span> Ren nunca esqueceu aquele momento. Seika também não.</figcaption>
      </figure>
    </section>

    <section class="chapter springs scene-observer" id="ren" data-season="primavera" data-chapter="ren">
      <div class="spring-moon" aria-hidden="true"></div>
      <div class="section-heading reveal">
        <p class="chapter-kicker">IV · As primaveras de Ren</p>
        <h2>Todo inverno ele partia.<br><em>Toda primavera ele voltava.</em></h2>
        <p class="lede">O que começou como gratidão à família que salvou sua vida virou tradição. Depois aprendizado. Depois amizade.</p>
      </div>

      <div class="spring-timeline" aria-label="A relação de Seika e Ren ao longo dos anos">
        <div class="spring-line" aria-hidden="true"><span></span></div>
        <article class="spring-beat reveal">
          <time>13 anos</time><div><h3>Recuperação</h3><p>Haru tratou as feridas. Mei garantiu descanso. Seika fez perguntas suficientes para testar a paciência de um Tengu já ferido.</p></div>
        </article>
        <article class="spring-beat reveal">
          <time>Primaveras</time><div><h3>A tradição</h3><p>Ren voltava para descansar. A família preparava o quarto. Seika acumulava perguntas — e as perguntas ficavam melhores.</p></div>
        </article>
        <article class="spring-beat reveal">
          <time>Depois</time><div><h3>Mentoria sem cerimônia</h3><p>Nunca houve um anúncio formal. Ren apenas percebeu que Seika já sabia o suficiente para ser perigoso sem orientação adequada.</p></div>
        </article>
        <article class="spring-beat reveal">
          <time>Amizade</time><div><h3>Parte da família</h3><p>Professor. Mentor. Amigo. Talvez algo ainda mais próximo — embora nenhum dos dois provavelmente dissesse isso em voz alta.</p></div>
        </article>
      </div>

      <blockquote class="ren-rule reveal">
        <p>Compreender uma entidade não significa confiar nela.</p>
        <small>Ren ensinou técnica. Seika trouxe cuidado.</small>
      </blockquote>
    </section>

    <section class="chapter tavern scene-observer" id="primeiro-exorcismo" data-season="primavera" data-chapter="primeiro-exorcismo">
      <div class="tavern-warmth" aria-hidden="true"></div>
      <div class="section-heading section-heading-light reveal">
        <p class="chapter-kicker">V · O primeiro exorcismo sozinho</p>
        <h2>Não era maligno.<br><em>Estava preso.</em></h2>
      </div>

      <div class="layered-scene exorcism-scene" data-tilt-scene>
        <div class="layered-back parallax-layer" data-depth="0.035">
          <img src="https://media.dnd.faysk.dev/lore/seika/f77ab8a083f1b1ad130a3970359d4cf4672a0f3ce682dabfbeca8a8e66055f34/exorcism-background-tavern.webp" alt="A taverna de Nao, com Nao ao balcão e Kenta observando junto à lareira." loading="lazy" />
        </div>
        <div class="layered-subject spirit-blue parallax-layer" data-depth="0.15">
          <img src="https://media.dnd.faysk.dev/lore/seika/2e66d3095ad542eb45cc0b6a7317c857a9a7e203d4e99ff854b822ec240b4588/exorcism-subject-spirit-table.webp" alt="Seika conduzindo seu primeiro exorcismo sozinho junto a uma mesa e um pequeno espírito felino azul." loading="lazy" />
        </div>
        <div class="blue-glow" aria-hidden="true"></div>
        <div class="scene-caption reveal">
          <span class="memory-index">17–18 anos</span>
          <h3>Conferiu os símbolos.</h3>
          <p>Preparou o incenso. Observou. Escutou. Resolveu o problema sem violência.</p>
        </div>
      </div>

      <div class="investigation-card reveal" data-investigation>
        <div class="investigation-tabs" role="tablist" aria-label="O método de Seika no primeiro exorcismo">
          <button class="active" type="button" role="tab" aria-selected="true" data-method="observar">Observar</button>
          <button type="button" role="tab" aria-selected="false" data-method="escutar">Escutar</button>
          <button type="button" role="tab" aria-selected="false" data-method="resolver">Resolver</button>
        </div>
        <div class="investigation-copy" id="investigationCopy">
          <strong>Primeiro: o fenômeno.</strong>
          <p>Objetos mudavam de lugar, portas abriam e passos apareciam depois que todos já haviam ido dormir.</p>
        </div>
      </div>

      <div class="dialogue reveal" aria-label="Conversa entre Ren e Seika">
        <p><span>REN</span> “Você fez bem.”</p>
        <p><span>SEIKA</span> “Eu sei.”</p>
        <small>Ren provavelmente se arrependeu imediatamente do elogio.</small>
      </div>

      <figure class="cinematic-strip cinematic-strip-tavern reveal" data-panorama>
        <img src="https://media.dnd.faysk.dev/lore/seika/386ead888a202639588f00b1f07bceebbe83f60f2423963d87f74d9956e530d9/wide-first-exorcism-full.webp" alt="Primeiro exorcismo de Seika em panorama dentro da taverna, com o pequeno espírito azul." loading="lazy" />
        <figcaption><span>A taverna</span> Depois disso, a vila passou a chamar Seika quando “alguma coisa estranha” acontecia.</figcaption>
      </figure>
    </section>

    <section class="chapter daily scene-observer" id="vida" data-season="primavera" data-chapter="vida">
      <div class="daily-bg parallax-bg" data-speed="0.04" aria-hidden="true"></div>
      <div class="daily-shade"></div>
      <div class="story-frame story-frame-right reveal">
        <p class="chapter-kicker">VI · A vida que ele gostava</p>
        <h2>O sobrenatural fazia parte da vida.<br><span>Mas nunca foi toda a vida.</span></h2>
        <p>Seika continuou sendo o filho dos herbalistas. Buscava ervas, preparava remédios, ajudava vizinhos e investigava qualquer barulho que alguém jurasse ser um fantasma.</p>
        <p>Às vezes era uma presença. Muitas vezes era rato no telhado, madeira estalando, febre, sonambulismo ou uma janela mal fechada.</p>
        <p>E às vezes cuidar significava apenas devolver a alguém a sensação de segurança na própria casa.</p>
      </div>

      <div class="npc-weave" aria-label="Pessoas que formaram Seika">
        <article class="npc-card reveal" style="--crop-x:12%;--crop-y:28%"><div class="npc-photo family-crop"></div><div><small>pai · herbalista</small><h3>Haru</h3><p>Observação, método e a desconfiança saudável de “deu certo da última vez”.</p></div></article>
        <article class="npc-card reveal" style="--crop-x:25%;--crop-y:30%"><div class="npc-photo family-crop"></div><div><small>mãe · herbalista</small><h3>Mei</h3><p>Escuta, empatia e o talento de perceber quando uma piada está escondendo preocupação.</p></div></article>
        <article class="npc-card reveal" style="--crop-x:39%;--crop-y:43%"><div class="npc-photo family-crop"></div><div><small>amiga · costureira</small><h3>Ami</h3><p>Casa, intimidade e a amiga que esteve no centro do primeiro encontro real com o sobrenatural — sem deixar o episódio definir a própria vida.</p></div></article>
        <article class="npc-card reveal" style="--crop-x:20%;--crop-y:23%"><div class="npc-photo tavern-crop"></div><div><small>amigo · cozinheiro</small><h3>Nao</h3><p>A âncora. O primeiro a perguntar se o “fantasma” não é só uma porta mal fechada.</p></div></article>
        <article class="npc-card reveal" style="--crop-x:82%;--crop-y:31%"><div class="npc-photo tavern-crop"></div><div><small>amigo · lenhador</small><h3>Kenta</h3><p>Lealdade, entusiasmo e a coragem irresponsável de apoiar uma ideia antes de verificar se ela presta.</p></div></article>
        <article class="npc-card reveal npc-ren"><div class="npc-photo ren-sigil"><span>羽</span></div><div><small>mentor · exorcista</small><h3>Ren</h3><p>Técnica, limites e respeito pelo sobrenatural — sem conseguir arrancar formalidade de Seika.</p></div></article>
      </div>
    </section>

    <section class="chapter absence scene-observer" id="ausencia" data-season="primavera" data-chapter="ausencia">
      <div class="absence-bg" aria-hidden="true"><img src="https://media.dnd.faysk.dev/lore/seika/d072348c904509d2a20563f021a06d3c3d82cdbd99db86560e760587e14ece3b/wide-village.webp" alt="" loading="lazy" /></div>
      <div class="absence-cool" aria-hidden="true"></div>
      <div class="absence-copy reveal">
        <p class="chapter-kicker">VII · A primavera em que Ren não voltou</p>
        <h2>A primavera chegou.<br><em>Ren não.</em></h2>
        <p>Na primeira semana, nada parecia errado. Na segunda, ainda podia ser atraso. Depois Seika começou a caminhar um pouco além do necessário quando procurava ervas na direção da estrada.</p>
      </div>

      <div class="waiting-counter reveal" aria-label="A espera de Seika">
        <div><strong>1</strong><span>semana</span><small>normal</small></div>
        <div><strong>2</strong><span>semanas</span><small>ainda possível</small></div>
        <div><strong>1</strong><span>mês</span><small>olhando a estrada</small></div>
        <div><strong>fim</strong><span>da primavera</span><small>não mais que isso</small></div>
      </div>

      <div class="letters reveal" aria-label="As cartas enviadas por Seika">
        <article class="letter">
          <span class="letter-thread"></span>
          <small>primeira carta</small>
          <p>Brincadeiras. Notícias da vila. Uma pergunta simples: quando você chega?</p>
          <i>sem resposta</i>
        </article>
        <article class="letter letter-second">
          <span class="letter-thread"></span>
          <small>algumas semanas depois</small>
          <p>O humor ainda estava ali. O fim da carta, não.</p>
          <blockquote>“Me avise que está bem.”</blockquote>
          <i>nada</i>
        </article>
      </div>

      <div class="route-measure reveal" aria-label="Distância até a cidade de Ren">
        <span>vila</span><div class="route-dashes" aria-hidden="true"></div><strong>≈ duas semanas de viagem</strong><div class="route-dashes" aria-hidden="true"></div><span>casa de Ren</span>
      </div>
    </section>

    <section class="chapter mantle scene-observer" id="manto" data-season="verao" data-chapter="manto">
      <div class="section-heading reveal">
        <p class="chapter-kicker">VIII · O manto</p>
        <h2>Ele não saiu sozinho.<br><em>A vila foi costurada nele.</em></h2>
      </div>

      <div class="layered-scene departure-layered" data-tilt-scene>
        <div class="layered-back parallax-layer" data-depth="0.035">
          <img src="https://media.dnd.faysk.dev/lore/seika/03634e0ca91fc754d829d30c1d266814217c36d7f196a95fde077f990071923c/departure-background-village.webp" alt="A vila no começo do verão, com família e amigos de Seika ao fundo." loading="lazy" />
        </div>
        <div class="layered-subject parallax-layer" data-depth="0.17">
          <img src="https://media.dnd.faysk.dev/lore/seika/5e4ee295cdb7165cd11535ed73bdd1bec50e66b66e653c98737f852c99ddc339/departure-subject-seika-ami.webp" alt="Seika adulto usando o manto de viagem enquanto Ami faz os últimos ajustes na roupa." loading="lazy" />
        </div>
        <div class="golden-bloom" aria-hidden="true"></div>
        <div class="scene-caption reveal">
          <span class="memory-index">começo do verão · 23 anos</span>
          <h3>“Você parece um pouco com o Ren.”</h3>
          <p>“Nossa. Ficou tão ruim assim?”</p>
        </div>
      </div>

      <div class="packed-home reveal">
        <h3>O que foi para a estrada</h3>
        <div class="packed-grid">
          <span><b>Haru</b><small>ervas úteis</small></span>
          <span><b>Mei</b><small>remédios, bandagens, provisões escondidas</small></span>
          <span><b>Nao</b><small>comida adequada para a viagem</small></span>
          <span><b>Kenta</b><small>conselhos úteis e preocupantes</small></span>
          <span><b>Ami</b><small>o manto, os bolsos, os espaços para talismãs</small></span>
          <span><b>Ren</b><small>uma silhueta que a roupa acabou evocando</small></span>
        </div>
      </div>

      <figure class="reference-frame reveal">
        <img src="https://media.dnd.faysk.dev/lore/seika/b485ee9d8d3671f28d0aad72f814281443a28f832f182a8f6f264ec066ad635f/04-departure-reference.webp" alt="Arte original da partida de Seika no começo do verão." loading="lazy" />
        <figcaption><small>registro original</small><strong>A partida</strong><span>Ele acreditava que voltaria em poucos meses.</span></figcaption>
      </figure>
    </section>

    <section class="departure-cinematic scene-observer" id="partida" data-season="verao" data-chapter="partida">
      <div class="departure-sticky">
        <div class="departure-pan" id="departurePan" aria-hidden="true"><img src="https://media.dnd.faysk.dev/lore/seika/74cf3cdab85ed37eac4a28276864449b9101716e63202ae32a9c314e299793b5/wide-departure-full.webp" alt="" loading="lazy" /></div>
        <div class="departure-overlay"></div>
        <div class="departure-lines" aria-live="off">
          <p data-departure-line="0">Não como aventureiro.</p>
          <p data-departure-line="1">Não como herói.</p>
          <p data-departure-line="2">Não como escolhido.</p>
          <p class="departure-main" data-departure-line="3">Apenas como alguém indo procurar um amigo<br>que deveria ter voltado para casa.</p>
        </div>
      </div>
    </section>

    <section class="promise scene-observer" data-season="inverno" data-chapter="promessa">
      <div class="promise-ink" aria-hidden="true"><img src="https://media.dnd.faysk.dev/lore/seika/f438b2f149ad7b187220861530234eb998853dc64d9869b3b84c1c3fb2f5f289/wide-adult-seika-full.webp" alt="" loading="lazy" /></div>
      <div class="promise-wash" aria-hidden="true"></div>
      <div class="promise-copy reveal">
        <small>Antes de sair, prometeu:</small>
        <blockquote>“Volto antes do inverno.”</blockquote>
        <p>Não porque pretendesse ficar fora por toda a estação. Era apenas o limite: antes que o clima piorasse, antes que as estradas ficassem ruins, antes que voltar se tornasse difícil.</p>
        <p class="promise-last">Naquele momento, Seika não via motivo algum para não acreditar.</p>
      </div>
    </section>

    <section class="character-codex scene-observer" id="caderno" data-season="inverno" data-chapter="caderno">
      <div class="codex-portrait reveal">
        <img src="https://media.dnd.faysk.dev/lore/seika/40f6c8d86f16c5556d4d467e86fd805a109385f3416b445af8bda8611242ceef/seika-reference.webp" alt="Retrato de corpo inteiro de Seika adulto, com manto preto, branco, dourado e violeta, talismãs e bastão ritual." loading="lazy" />
        <div class="portrait-moon" aria-hidden="true"></div>
      </div>
      <div class="codex-copy reveal">
        <p class="chapter-kicker">Caderno de viagem</p>
        <h2>Quem é Seika?</h2>
        <p class="codex-lede">Gentil sem ser ingênuo. Curioso sem ser acadêmico. Prestativo a ponto de frequentemente complicar os próprios planos.</p>
        <div class="principles">
          <p>Se pode ajudar sem causar um mal maior, deve tentar.</p>
          <p>Quem pede ajuda merece pelo menos ser ouvido.</p>
          <p>Nem todo espírito é maligno.</p>
          <p>Compreender não significa confiar.</p>
          <p>Poder existe para proteger quem não consegue se proteger sozinho.</p>
          <p>Casa continua sendo casa, mesmo quando ele está longe.</p>
        </div>
      </div>

      <div class="roleplay-notes reveal">
        <article><span>Lucky</span><p>Amigos de infância ainda podem chamá-lo assim. Ele reclama mais do que realmente se incomoda.</p></article>
        <article><span>Humor</span><p>Quando está preocupado, é comum uma piada chegar antes da admissão.</p></article>
        <article><span>Ervas</span><p>Reconhece muitas pelo cheiro e pensa em Haru quando encontra uma rara.</p></article>
        <article><span>Estrada</span><p>Ainda tem o péssimo hábito de se desviar do próprio caminho para ajudar alguém.</p></article>
        <article><span>Espíritos</span><p>A primeira pergunta continua sendo “o que está acontecendo?”, não “como eu destruo isso?”.</p></article>
        <article><span>Falha possível</span><p>Tem dificuldade em aceitar que alguém não pode ser salvo enquanto ainda existir alguma possibilidade de tentar.</p></article>
      </div>
    </section>

    <section class="unanswered scene-observer" data-season="inverno" aria-labelledby="selos-titulo">
      <div class="unanswered-head reveal">
        <p class="chapter-kicker">Selos não respondidos</p>
        <h2 id="selos-titulo">Algumas perguntas devem continuar abertas.</h2>
        <p>Esta página não transforma símbolo visual em resposta canônica. O mistério de Seika continua sendo mistério.</p>
      </div>
      <details class="dm-vault reveal">
        <summary><span>⚿</span> Abrir notas do DM <small>spoilers e ganchos abertos</small></summary>
        <div class="seal-grid">
          <article><b>01</b><h3>Lucky</h3><p>Coincidência, poder precoce, influência externa ou outra coisa?</p></article>
          <article><b>02</b><h3>O ritual de Ami</h3><p>O que exatamente respondeu quando Seika tentou ajudar?</p></article>
          <article><b>03</b><h3>Ren</h3><p>Ferido, desaparecido, preso, evitando a vila ou envolvido em algo maior?</p></article>
          <article><b>04</b><h3>As cartas</h3><p>Chegaram, foram interceptadas ou simplesmente ficaram sem resposta?</p></article>
          <article><b>05</b><h3>Vida, cura e espíritos</h3><p>Existe relação entre os poderes de Seika e essa afinidade?</p></article>
          <article><b>06</b><h3>O inverno</h3><p>A promessa será cumprida?</p></article>
        </div>
      </details>
    </section>

    <section class="visual-archive scene-observer" id="arquivo" data-season="inverno" aria-labelledby="arquivo-titulo">
      <div class="archive-head reveal">
        <p class="chapter-kicker">Arquivo visual</p>
        <h2 id="arquivo-titulo">25 registros, uma mesma história.</h2>
        <p>Originais, camadas, fundos e panoramas usados na experiência. Toque em qualquer imagem para abrir em tela cheia.</p>
      </div>
      <div class="archive-grid" id="archiveGrid">
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/f84b50b92543b8bf05001202f9bb6b5e13ebc48b8094442f272cd17c9e1d504e/01-lucky-reference.webp"><img src="https://media.dnd.faysk.dev/lore/seika/f84b50b92543b8bf05001202f9bb6b5e13ebc48b8094442f272cd17c9e1d504e/01-lucky-reference.webp" alt="Arte original: Lucky nas ruínas" loading="lazy"><span>01 · Lucky — original</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/93e74440f5882a83fd394385055fedd223e69d1dc8d2629b0d13a2b409153169/02-ami-ritual-reference.webp"><img src="https://media.dnd.faysk.dev/lore/seika/93e74440f5882a83fd394385055fedd223e69d1dc8d2629b0d13a2b409153169/02-ami-ritual-reference.webp" alt="Arte original: ritual de Ami" loading="lazy"><span>02 · Ritual de Ami — original</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/c099ad29f9d5141d280303c0da999b534805222b73a08a9069388011d438b055/03-first-exorcism-reference.webp"><img src="https://media.dnd.faysk.dev/lore/seika/c099ad29f9d5141d280303c0da999b534805222b73a08a9069388011d438b055/03-first-exorcism-reference.webp" alt="Arte original: primeiro exorcismo" loading="lazy"><span>03 · Primeiro exorcismo — original</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/b485ee9d8d3671f28d0aad72f814281443a28f832f182a8f6f264ec066ad635f/04-departure-reference.webp"><img src="https://media.dnd.faysk.dev/lore/seika/b485ee9d8d3671f28d0aad72f814281443a28f832f182a8f6f264ec066ad635f/04-departure-reference.webp" alt="Arte original: partida" loading="lazy"><span>04 · Partida — original</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/40f6c8d86f16c5556d4d467e86fd805a109385f3416b445af8bda8611242ceef/seika-reference.webp"><img src="https://media.dnd.faysk.dev/lore/seika/40f6c8d86f16c5556d4d467e86fd805a109385f3416b445af8bda8611242ceef/seika-reference.webp" alt="Design completo de Seika adulto" loading="lazy"><span>Seika · design adulto</span></button>

        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/5768c8b4c277ae7bb056799b75d2f21e0de020152a1fc0b83630e6b81bdedeba/lucky-subject.webp"><img src="https://media.dnd.faysk.dev/lore/seika/5768c8b4c277ae7bb056799b75d2f21e0de020152a1fc0b83630e6b81bdedeba/lucky-subject.webp" alt="Camada transparente: Seika criança" loading="lazy"><span>Lucky · personagem</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/54afc25a18ee299a3249baa9d2dc403076ec2961bbf8f96eb5cfc36a063335d4/lucky-background.webp"><img src="https://media.dnd.faysk.dev/lore/seika/54afc25a18ee299a3249baa9d2dc403076ec2961bbf8f96eb5cfc36a063335d4/lucky-background.webp" alt="Fundo das ruínas sem Seika" loading="lazy"><span>Lucky · fundo</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/dc62be5a52882cac6cbe01f91bfa024da7246e8f39551412372a0e36a069e4b7/ritual-subject-spirit.webp"><img src="https://media.dnd.faysk.dev/lore/seika/dc62be5a52882cac6cbe01f91bfa024da7246e8f39551412372a0e36a069e4b7/ritual-subject-spirit.webp" alt="Camada transparente: Seika e presença violeta" loading="lazy"><span>Ami · Seika + presença</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/943f29f9b616f14630514d784d9d46b29a4a65cf2925dfdcb06e8201a1db7181/ritual-background-ami-ren.webp"><img src="https://media.dnd.faysk.dev/lore/seika/943f29f9b616f14630514d784d9d46b29a4a65cf2925dfdcb06e8201a1db7181/ritual-background-ami-ren.webp" alt="Fundo do ritual com Ami e Ren" loading="lazy"><span>Ami · fundo + Ren</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/2e66d3095ad542eb45cc0b6a7317c857a9a7e203d4e99ff854b822ec240b4588/exorcism-subject-spirit-table.webp"><img src="https://media.dnd.faysk.dev/lore/seika/2e66d3095ad542eb45cc0b6a7317c857a9a7e203d4e99ff854b822ec240b4588/exorcism-subject-spirit-table.webp" alt="Camada transparente: Seika, espírito, pote e mesa" loading="lazy"><span>Exorcismo · personagem + espírito</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/f77ab8a083f1b1ad130a3970359d4cf4672a0f3ce682dabfbeca8a8e66055f34/exorcism-background-tavern.webp"><img src="https://media.dnd.faysk.dev/lore/seika/f77ab8a083f1b1ad130a3970359d4cf4672a0f3ce682dabfbeca8a8e66055f34/exorcism-background-tavern.webp" alt="Fundo da taverna com Nao e Kenta" loading="lazy"><span>Taverna · fundo</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/5e4ee295cdb7165cd11535ed73bdd1bec50e66b66e653c98737f852c99ddc339/departure-subject-seika-ami.webp"><img src="https://media.dnd.faysk.dev/lore/seika/5e4ee295cdb7165cd11535ed73bdd1bec50e66b66e653c98737f852c99ddc339/departure-subject-seika-ami.webp" alt="Camada transparente: Seika adulto e Ami" loading="lazy"><span>Partida · Seika + Ami</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/03634e0ca91fc754d829d30c1d266814217c36d7f196a95fde077f990071923c/departure-background-village.webp"><img src="https://media.dnd.faysk.dev/lore/seika/03634e0ca91fc754d829d30c1d266814217c36d7f196a95fde077f990071923c/departure-background-village.webp" alt="Fundo da vila com família e amigos" loading="lazy"><span>Partida · vila</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/ae5e52eaba48fdb16364289a6e5b9e1d9c952142a0b2a67d56b7303f9af01a9d/adult-seika-subject-spirit.webp"><img src="https://media.dnd.faysk.dev/lore/seika/ae5e52eaba48fdb16364289a6e5b9e1d9c952142a0b2a67d56b7303f9af01a9d/adult-seika-subject-spirit.webp" alt="Camada transparente: Seika adulto e fumaça espiritual" loading="lazy"><span>Seika adulto · camada</span></button>
        <button class="archive-item reveal" data-full="https://media.dnd.faysk.dev/lore/seika/34fe1d5097985f7cd56982401d1f3ef8522de79a6184a1798d26f0558e541a15/adult-seika-ink-background.webp"><img src="https://media.dnd.faysk.dev/lore/seika/34fe1d5097985f7cd56982401d1f3ef8522de79a6184a1798d26f0558e541a15/adult-seika-ink-background.webp" alt="Fundo em tinta com lua dourada" loading="lazy"><span>Seika adulto · fundo</span></button>

        <button class="archive-item wide reveal" data-full="https://media.dnd.faysk.dev/lore/seika/2e223c08e8b273dec7a27e114a37e89f3039f108f64787ab1a17d3df4acdccc6/wide-ink-moon.webp"><img src="https://media.dnd.faysk.dev/lore/seika/2e223c08e8b273dec7a27e114a37e89f3039f108f64787ab1a17d3df4acdccc6/wide-ink-moon.webp" alt="Panorama em tinta e lua dourada" loading="lazy"><span>Panorama · tinta e lua</span></button>
        <button class="archive-item wide reveal" data-full="https://media.dnd.faysk.dev/lore/seika/ed730ca6777d0458469a014328fc3945c3611afa8907f0fb01da2d0ebfa1fe45/wide-ruins.webp"><img src="https://media.dnd.faysk.dev/lore/seika/ed730ca6777d0458469a014328fc3945c3611afa8907f0fb01da2d0ebfa1fe45/wide-ruins.webp" alt="Panorama das ruínas sem personagem" loading="lazy"><span>Panorama · ruínas</span></button>
        <button class="archive-item wide reveal" data-full="https://media.dnd.faysk.dev/lore/seika/d072348c904509d2a20563f021a06d3c3d82cdbd99db86560e760587e14ece3b/wide-village.webp"><img src="https://media.dnd.faysk.dev/lore/seika/d072348c904509d2a20563f021a06d3c3d82cdbd99db86560e760587e14ece3b/wide-village.webp" alt="Panorama da vila sem Seika" loading="lazy"><span>Panorama · vila</span></button>
        <button class="archive-item wide reveal" data-full="https://media.dnd.faysk.dev/lore/seika/e6d926a5beaf08642146249432460182fef1a88d69199b32f0195e206399170e/wide-ritual-room.webp"><img src="https://media.dnd.faysk.dev/lore/seika/e6d926a5beaf08642146249432460182fef1a88d69199b32f0195e206399170e/wide-ritual-room.webp" alt="Panorama da sala ritual" loading="lazy"><span>Panorama · ritual</span></button>
        <button class="archive-item wide reveal" data-full="https://media.dnd.faysk.dev/lore/seika/872179cb0089635bf5d8600d3433e745fccd0924df7f7c8ce55c5c8714665980/wide-tavern.webp"><img src="https://media.dnd.faysk.dev/lore/seika/872179cb0089635bf5d8600d3433e745fccd0924df7f7c8ce55c5c8714665980/wide-tavern.webp" alt="Panorama da taverna" loading="lazy"><span>Panorama · taverna</span></button>
        <button class="archive-item wide reveal" data-full="https://media.dnd.faysk.dev/lore/seika/a02d6f1ccc772a78f130113b2a7edda88bd0dfbb422be651a75390f8cbcfc7ad/wide-lucky-full.webp"><img src="https://media.dnd.faysk.dev/lore/seika/a02d6f1ccc772a78f130113b2a7edda88bd0dfbb422be651a75390f8cbcfc7ad/wide-lucky-full.webp" alt="Panorama completo: Lucky nas ruínas" loading="lazy"><span>Panorama · Lucky</span></button>
        <button class="archive-item wide reveal" data-full="https://media.dnd.faysk.dev/lore/seika/74cf3cdab85ed37eac4a28276864449b9101716e63202ae32a9c314e299793b5/wide-departure-full.webp"><img src="https://media.dnd.faysk.dev/lore/seika/74cf3cdab85ed37eac4a28276864449b9101716e63202ae32a9c314e299793b5/wide-departure-full.webp" alt="Panorama completo: despedida na vila" loading="lazy"><span>Panorama · despedida</span></button>
        <button class="archive-item wide reveal" data-full="https://media.dnd.faysk.dev/lore/seika/8ef2730e025f01bb6ae59dffdcfad1994a4835cd4e43d574cd35e1c02fda0b16/wide-ami-ritual-full.webp"><img src="https://media.dnd.faysk.dev/lore/seika/8ef2730e025f01bb6ae59dffdcfad1994a4835cd4e43d574cd35e1c02fda0b16/wide-ami-ritual-full.webp" alt="Panorama completo: ritual de Ami" loading="lazy"><span>Panorama · ritual de Ami</span></button>
        <button class="archive-item wide reveal" data-full="https://media.dnd.faysk.dev/lore/seika/386ead888a202639588f00b1f07bceebbe83f60f2423963d87f74d9956e530d9/wide-first-exorcism-full.webp"><img src="https://media.dnd.faysk.dev/lore/seika/386ead888a202639588f00b1f07bceebbe83f60f2423963d87f74d9956e530d9/wide-first-exorcism-full.webp" alt="Panorama completo: primeiro exorcismo" loading="lazy"><span>Panorama · primeiro exorcismo</span></button>
        <button class="archive-item wide reveal" data-full="https://media.dnd.faysk.dev/lore/seika/f438b2f149ad7b187220861530234eb998853dc64d9869b3b84c1c3fb2f5f289/wide-adult-seika-full.webp"><img src="https://media.dnd.faysk.dev/lore/seika/f438b2f149ad7b187220861530234eb998853dc64d9869b3b84c1c3fb2f5f289/wide-adult-seika-full.webp" alt="Panorama completo: Seika adulto em cenário de tinta" loading="lazy"><span>Panorama · Seika adulto</span></button>
      </div>
    </section>

    <footer class="finale">
      <div class="finale-mark" aria-hidden="true">◐</div>
      <p>SEIKA</p>
      <strong>Antes do Inverno</strong>
      <small>Uma história sobre cuidado, casa e a estrada que começa quando alguém não volta.</small>
      <a href="#topo">voltar ao começo ↑</a>
    </footer>
  </main>

  <dialog class="lightbox" id="lightbox" aria-label="Visualizador de imagem">
    <button class="lightbox-close" id="lightboxClose" type="button" aria-label="Fechar imagem">×</button>
    <img id="lightboxImage" src="" alt="" />
    <p id="lightboxCaption"></p>
  </dialog>

  <noscript>
    <style>.reveal{opacity:1!important;transform:none!important}.parallax-layer{transform:none!important}</style>
  </noscript>
  <script src="script.js" defer></script>
</body>
</html>
`;

export function GET() {
 return new Response(BODY, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=3600" } });
}
