# Pipipi — lore cinematográfica pioneira

> Status: candidato completo em branch; Fases 1–3 concluídas; não integrado e não publicado
> Owner: narrative-memory / frontend
> Última revisão: 2026-09-10
> Branch candidata: `feat/pipipi-cinematic-lore`

## Objetivo

Implementar `/lore/pipipi` como a primeira lore editorial longa do TDA, preservando o texto aprovado como leitura HTML completa e usando cinematic apenas como enhancement visual.

A experiência é organizada em três atos editoriais:

1. **A Casa** — a memória infantil permanece quente, lúdica e parcialmente fragmentada;
2. **O outro nome da Casa** — a virada `Pipipi não mentiu nenhuma vez.` recontextualiza as mesmas memórias;
3. **O que ficou** — Pipipi passa a ser representada pelos portraits de fantasma, enquanto a página volta a privilegiar leitura e permanência.

## Fonte editorial

O texto aprovado da rodada fica versionado em `src/features/lore/pipipi-story.ts` e não é derivado automaticamente da projection pública do banco.

Essa exceção é deliberada para a lore pioneira: na verificação de 2026-09-09 não existia entity `slug = 'pipipi'` na tabela `entities` de produção. O candidato **não cria uma entity nem altera o banco por conveniência**. A rota `/lore/pipipi` usa o conteúdo editorial aprovado diretamente até existir um contrato de projection pública equivalente e revisado.

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

`ultimo-dia` permanece uma **associação editorial candidata**: o asset existe no pack fornecido, mas o HTML oficial de origem não o associa explicitamente a uma seção. A ligação deve ser revisada antes de chamar a entrega de canônica/publicada.

## Assets

O runtime usa 18 derivados AVIF: sete backgrounds, seis subjects transparentes e cinco portraits de fantasma. Os masters/intermediários não são fonte de runtime.

Os 18 derivados finais ficam versionados **diretamente** em `public/lore/pipipi/`. Não existe reconstrução em `pnpm dev`/`pnpm build`, bundle de staging ou bootstrap de assets no caminho de produção.

O conjunto final ocupa 439.157 bytes e cada arquivo tem dimensões, alpha, tamanho e SHA-256 fixados em `docs/integrations/evidence/pipipi-cinematic-assets-2026-09-10.json`. Assim, o SHA da branch contém exatamente os bytes que o navegador usa e a integridade pode ser conferida sem depender de materialização temporária.

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

A rota continua sendo candidata até merge e publicação deliberados.

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

## Critérios de aceite do candidato

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
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm design:check`, `pnpm docs:check`, `pnpm db:docs:check`, build, E2E e `test:processing` verdes nos checkpoints de gate;
- merge e publicação tratados como ações separadas.

## Não objetivos desta rodada

- criar ou alterar entity/canon no Supabase para encaixar a implementação;
- autoplay de áudio;
- WebGL/GSAP/Pixi;
- transformar todas as lores em páginas artesanais;
- inferir novos fatos a partir das ilustrações;
- declarar a associação de `ultimo-dia` canônica sem revisão editorial.
