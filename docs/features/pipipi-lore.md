# Pipipi — lore cinematográfica pioneira

> Status: implementação, QA e publicação em production concluídos
> Owner: narrative-memory / frontend
> Última revisão: 2026-09-12
> Integração: PR #118, merge commit `28668fb169534d1de7cd8a47046a9fbd0d327dfe`

## Objetivo

Escopo editorial atualizado em 2026-09-12: o contrato de [lores independentes](independent-lores.md) permite identidade própria por página. A composição de Pipipi descrita abaixo documenta esta entrega; não obriga outras lores a reutilizá-la nem a seguir o DS do site.

Implementar `/lore/pipipi` como a primeira lore editorial longa do TDA, preservando o texto aprovado como leitura HTML completa e usando cinematic apenas como enhancement visual.

A experiência é organizada em três atos editoriais:

1. **A Casa** — a memória infantil permanece quente, lúdica e parcialmente fragmentada;
2. **O outro nome da Casa** — a virada `Pipipi não mentiu nenhuma vez.` recontextualiza as mesmas memórias;
3. **O que ficou** — Pipipi passa a ser representada pelos portraits de fantasma, enquanto a página volta a privilegiar leitura e permanência.

## Fonte editorial

O texto aprovado da rodada fica versionado em `src/features/lore/pipipi-story.ts` e não é derivado automaticamente da projection pública do banco.

Essa exceção é deliberada para a lore pioneira: na verificação de 2026-09-09 não existia entity `slug = 'pipipi'` na tabela `entities` de produção. A implementação **não cria uma entity nem altera o banco por conveniência**. A rota `/lore/pipipi` usa o conteúdo editorial aprovado diretamente até existir um contrato de projection pública equivalente e revisado.

Isso não generaliza uma nova família `/lore/[slug]`; continua sendo a exceção específica já prevista para Pipipi.

## Composição visual

O Hero usa um palco ilustrado como background e Pipipi fantasma como subject transparente separado. O portrait permanece estático; o único cue autônomo do Hero é a indicação de scroll, limitada a três ciclos. Não existe autoplay de áudio nem animação decorativa infinita na experiência Pipipi.

As cenas principais usam a mesma gramática:

- background reconstruído sem o elemento principal;
- subject principal separado com alpha;
- texto da lore permanece em HTML fora da imagem;
- scroll controla câmera e separação entre background/subject;
- `corredores` recebe a maior amplitude;
- `cadeira` e `ultimo-dia` usam amplitudes de movimento menores;
- `prefers-reduced-motion` remove sticky/parallax decorativo e preserva a composição estática;
- sem JavaScript, o texto cinematográfico permanece totalmente legível e visível.

Cenas preparadas:

- `casa`;
- `super-herois`;
- `corredores`;
- `cadeira`;
- `ultimo-dia`;
- `acordou`.

### Revisão editorial de `ultimo-dia`

A associação foi revisada em 2026-09-10 diretamente contra o pack original fornecido pelo usuário (`pipipi-lore-premium.zip`). O HTML de origem não insere `assets/ultimo_dia.webp` por `<img>` em uma seção específica, portanto a implementação não deve fingir que existe um vínculo DOM que não existe.

A associação editorial, porém, é sustentada pelo próprio pacote e pelo texto fonte em conjunto:

- o asset original é nomeado explicitamente `assets/ultimo_dia.webp`;
- a ilustração representa Pipipi em um quarto hospitalar cercada pela família, coerente com a passagem **O Dia em que Todo Mundo Faltou ao Trabalho**;
- o texto dessa sequência registra a chegada dos familiares no mesmo dia e depois identifica esse dia como a última lembrança daquele dia;
- trechos posteriores da própria lore tratam esse acontecimento como o último dia de Pipipi e como um dos dias mais felizes de sua curta vida.

Com essa revisão, `ultimo-dia` deixa de ser uma associação pendente. A aprovação vale como composição editorial da lore; ela **não** autoriza inferir novos fatos narrativos a partir da ilustração além do texto aprovado.

## Assets

O runtime usa 18 derivados AVIF: sete backgrounds, seis subjects transparentes e cinco portraits de fantasma. Os masters/intermediários não são fonte de runtime.

Os 18 derivados finais ficam versionados **diretamente** em `public/lore/pipipi/`. Não existe reconstrução em `pnpm dev`/`pnpm build`, bundle de staging ou bootstrap de assets no caminho de produção.

O conjunto final ocupa 439.157 bytes e cada arquivo tem dimensões, alpha, tamanho e SHA-256 fixados em `docs/integrations/evidence/pipipi-cinematic-assets-2026-09-10.json`. Assim, o SHA integrado contém exatamente os bytes que o navegador usa e a integridade pode ser conferida sem depender de materialização temporária.

## Runtime e performance

- DOM/CSS + `requestAnimationFrame`; nenhuma engine adicional;
- RAF só é agendado em scroll/resize e enquanto a cena está próxima/visível;
- `IntersectionObserver` evita trabalho em cenas fora da viewport;
- backgrounds e subjects usam `next/image`;
- Hero prioriza somente os assets acima da dobra;
- cenas posteriores ficam elegíveis a lazy loading do `next/image`;
- mobile não depende de mouse;
- reduced motion mantém toda a história legível;
- nenhuma animação CSS da experiência Pipipi usa iteração infinita.

## Rota e metadata

`src/app/lore/pipipi/page.tsx` é uma rota dedicada e reutiliza `buildPublicMetadata`. Ela não consulta `findPublishedLoreProfile` enquanto a projection de Pipipi não existir, evitando que a lore aprovada retorne 404 apenas por ausência da entity no banco.

A rota está integrada à `main` pelo merge commit `28668fb169534d1de7cd8a47046a9fbd0d327dfe`. Em 2026-09-10, antes do deployment deliberado seguinte, `https://dnd.faysk.dev/lore/pipipi` ainda respondia 404; esse registro histórico comprova que integração e publicação são estados separados.

Em 2026-09-11 a rota foi verificada no domínio oficial já publicada em production: HTTP `200`, título `Pipipi — A Casa Onde os Super-Heróis Visitavam · TDA`, descrição própria e canonical `https://dnd.faysk.dev/lore/pipipi`. A imagem Open Graph observada ainda usa o fallback genérico `/og/default`; uma arte social própria de Pipipi permanece melhoria separada e não é tratada como requisito retroativo para considerar a rota publicada.

## QA e evidência da Fase 3

O polish final foi validado em Chromium real no CI em desktop 1080p, desktop 2K, mobile e `prefers-reduced-motion`.

Checkpoint visual do produto: `be5110426cbf431c795fcbf9e5fcd7144e5dbe7a`.

- workflow `CI` 590 concluído com sucesso;
- workflow `Companion` 347 concluído com sucesso no mesmo SHA;
- `pnpm check`, build, E2E, `test:processing` e job Postgres verdes;
- artifact `pipipi-visual-qa` id `10135596709`, digest `sha256:91920be4f608ec019039a1012a2e6612006fdf847665e417cfcf15012a5334cb`;
- Hero deixa de ser limitado a 980px em telas altas e ocupa o palco disponível abaixo do header;
- cinematic mobile usa palco de viewport inteira, removendo o letterbox excessivo;
- removido o `<main>` aninhado: a página preserva um único landmark principal fornecido pelo layout global;
- fallback sem JavaScript começa com copy visível (`opacity: 1`, sem offset inicial);
- animações decorativas infinitas foram removidas; o movimento narrativo principal continua dirigido por scroll;
- captura de `ghost-arrival` espera a imagem lazy-loaded completar antes de registrar a evidência.

As capturas de QA são evidência efêmera de CI e não fazem parte do runtime nem precisam permanecer versionadas no repositório. Depois da inspeção, o spec de captura e os passos temporários de upload foram removidos, o workflow normal de CI foi restaurado e o catálogo documental foi regenerado. A cobertura E2E permanente de estrutura, assets, fallback, viewport, movimento finito e reduced motion permanece versionada em `tests/pipipi-cinematic.spec.ts`.

## Gate pós-merge

O merge commit exato `28668fb169534d1de7cd8a47046a9fbd0d327dfe` foi validado novamente na `main`:

- `CI` run 606: `completed / success`;
- `Companion` run 363: `completed / success`;
- ambos executados por `push` sobre o SHA exato do merge.

Portanto, o recorte de implementação + QA + polimento ficou **100% concluído no código integrado** antes da publicação, mantendo o gate operacional separado.

## Publicação em production — 2026-09-11

- `main` observada: `ad6d9334471c93a591660e9dc8089e102fc4638a`;
- deployment Vercel: `dpl_FyLWMwVXm4rwGV23khpQkb5qHStU`;
- target: `production`;
- estado observado: `READY`;
- metadata do deployment associa o artefato ao mesmo source SHA `ad6d9334471c93a591660e9dc8089e102fc4638a`;
- `https://dnd.faysk.dev/lore/pipipi` respondeu HTTP `200` na verificação de 2026-09-11;
- título, descrição e canonical próprios foram observados no HTML servido;
- a imagem social ainda resolve para o fallback genérico `/og/default`, portanto OG específico continua melhoria posterior.

Este recibo confirma a publicação da lore pioneira sem inferir migration, alteração de dados, grant, DNS ou qualquer outra operação que não tenha sido observada nessa verificação.

## Critérios de aceite técnico-editorial

### Correção de qualidade dos três quadros — 2026-09-12

`super-herois`, `cadeira` e `ultimo-dia` passam a consumir WebP lossless no R2 em 1672×941, derivados dos três PNGs fornecidos pelo autor. [Evidência de integridade e resolução](../integrations/evidence/pipipi-original-quality-2026-09-12.json): bytes públicos verificados por SHA-256 e pixels RGBA idênticos aos PNGs. Os arquivos anteriores tinham, respectivamente, 1280×720, 960×540 e 480×270.

O consumidor mantém `unoptimized`, evitando outra recompressão. Enquadramento, proporção, texto, sombra e frame estático permanecem iguais. Os arquivos antigos ficam disponíveis apenas para referências em cache; não são mais selecionados pelo consumidor atualizado. O E2E exige a resolução original, imagem única e ausência de movimento nas três cenas em desktop e celular. A publicação deve ser confirmada pelo recibo da PR de promoção e `/api/version`, separadamente da existência dos objetos no R2.

Rollback: reverter as três URLs do consumidor pelo fluxo Preview → main; preservar os objetos publicados no R2. Não há migration ou alteração de permissões.

### Checklist geral

- texto aprovado preservado e coberto por teste estrutural;
- ordem dos três atos preservada;
- turning point preservado literalmente;
- seis cenas vinculadas exatamente uma vez;
- backgrounds e subjects corretos por cena;
- Hero com palco + portrait de ghost;
- scroll cinematic sem loop de RAF permanente;
- desktop 1080p, desktop 2K e mobile revisados visualmente;
- `prefers-reduced-motion` funcional e revisado;
- fallback sem JavaScript legível;
- landmark principal sem `<main>` aninhado;
- nenhuma animação decorativa infinita na experiência Pipipi;
- foco/links/heading hierarchy utilizáveis por teclado;
- todos os assets de runtime versionados e validados por hash no SHA testado;
- `ultimo-dia` revisado contra o pack original sem transformar ilustração em nova fonte factual;
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm design:check`, `pnpm docs:check`, `pnpm db:docs:check`, build, E2E e `test:processing` verdes nos checkpoints de gate;
- merge e publicação tratados como ações separadas.

## Não objetivos desta rodada

- criar ou alterar entity/canon no Supabase para encaixar a implementação;
- autoplay de áudio;
- WebGL/GSAP/Pixi;
- transformar todas as lores em páginas artesanais;
- inferir novos fatos a partir das ilustrações.
