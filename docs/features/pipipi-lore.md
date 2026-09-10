# Pipipi — lore cinematográfica pioneira

> Status: candidato em branch; não integrado e não publicado
> Owner: narrative-memory / frontend
> Última revisão: 2026-09-09
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

O Hero usa um palco ilustrado como background e Pipipi fantasma como subject transparente separado. O subject recebe somente uma animação CSS curta e contínua de flutuação; não existe autoplay de áudio.

As cenas principais usam a mesma gramática:

- background reconstruído sem o elemento principal;
- subject principal separado com alpha;
- texto da lore permanece em HTML fora da imagem;
- scroll controla câmera e separação entre background/subject;
- `corredores` recebe a maior amplitude;
- `cadeira` e `ultimo-dia` usam movimento de respiração quase imperceptível;
- `prefers-reduced-motion` remove sticky/parallax decorativo e preserva a composição estática.

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

Os 18 derivados ficam versionados em um único bundle binário `ustar`, `.asset-bundles/pipipi-runtime-v4.tar`. `tools/bootstrap-pipipi-assets.mjs` valida o SHA-256 do bundle, o conjunto exato de nomes e o SHA-256 individual de cada asset antes de materializá-los em `public/lore/pipipi/`.

`pnpm dev` e `pnpm build` executam essa materialização antes de iniciar o Next.js. Assim, um checkout limpo do SHA testado produz exatamente os bytes registrados em `docs/integrations/evidence/pipipi-cinematic-assets-2026-09-09.json`; bundle incompleto, alterado ou com arquivo inesperado falha o build em vez de publicar uma página parcial.

## Runtime e performance

- DOM/CSS + `requestAnimationFrame`; nenhuma engine adicional;
- RAF só é agendado em scroll/resize e enquanto a cena está próxima/visível;
- `IntersectionObserver` evita trabalho em cenas fora da viewport;
- backgrounds e subjects usam `next/image`;
- Hero prioriza somente os assets acima da dobra;
- cenas posteriores ficam elegíveis a lazy loading do `next/image`;
- mobile não depende de mouse;
- reduced motion mantém toda a história legível.

## Rota e metadata

`src/app/lore/pipipi/page.tsx` é uma rota dedicada e reutiliza `buildPublicMetadata`. Ela não consulta `findPublishedLoreProfile` enquanto a projection de Pipipi não existir, evitando que a lore aprovada retorne 404 apenas por ausência da entity no banco.

A rota continua sendo candidata até merge e publicação deliberados.

## Critérios de aceite do candidato

- texto aprovado preservado e coberto por teste estrutural;
- ordem dos três atos preservada;
- turning point preservado literalmente;
- seis cenas vinculadas exatamente uma vez;
- backgrounds e subjects corretos por cena;
- Hero com palco + ghost flutuante;
- scroll cinematic sem loop de RAF permanente;
- desktop e mobile revisados visualmente;
- `prefers-reduced-motion` funcional;
- foco/links/heading hierarchy utilizáveis por teclado;
- todos os assets de runtime reproduzíveis e validados por hash no SHA testado;
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm design:check`, `pnpm docs:check` e `pnpm db:docs:check` verdes no mesmo SHA;
- merge e publicação tratados como ações separadas.

## Não objetivos desta rodada

- criar ou alterar entity/canon no Supabase para encaixar a implementação;
- autoplay de áudio;
- WebGL/GSAP/Pixi;
- transformar todas as lores em páginas artesanais;
- inferir novos fatos a partir das ilustrações;
- declarar a associação de `ultimo-dia` canônica sem revisão editorial.
