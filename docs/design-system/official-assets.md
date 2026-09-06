# Assets oficiais da marca TDA

> Status: canônico para marca; integração runtime parcial e verificável
> Owner: brand / design-system
> Última revisão: 2026-09-06

Este documento registra o **TDA Brand Pack (official)** fornecido para o reboot.

O Brand Pack define a geometria e os masters oficiais da marca. O Design System define como a interface recebe essa marca. Um não substitui o outro.

## Identidade

- nome curto: **TDA**;
- nome completo: **TDA — Tem Dado Aqui**;
- símbolo principal: d20 geométrico com o pato ao centro;
- ícone compacto: silhueta isolada do pato;
- tagline oficial sugerida: **Rolamos dados. Guardamos os dados.**;
- descrição curta sugerida: **Sessões, personagens, histórias e memórias da nossa campanha.**

## Integridade do pacote recebido

Arquivo: `tda-brand-pack (official).zip`.

SHA-256 do ZIP:

`a56c89cc4d34888548168b87b71f3f369c686d46381c92b1a823169ed68e0cab`

Checksums de referência:

| Asset | SHA-256 |
| --- | --- |
| `README.md` | `e710efa24577452f3c3593e367d049378360ef5ecef54ee01d2a921c8f176c49` |
| `docs/BRAND_GUIDE.md` | `7fc3d28adfffc196ae5668972499782f2165870dd2fb269407a5558b835f61f9` |
| `logos/tda-mark.svg` | `769d9d1bf1cc51794c8564b5af800db7897d258c007a016ab3292198d5de86e7` |
| `logos/tda-horizontal-black.png` | `c1f7c1b6944625256ed3e4df21c220c9f58d585f720d5c953d77011ea6f65ee5` |
| `logos/tda-horizontal-white.png` | `1403ac71594524facd12bcb24870b8f49df8a8773409b3b210bdda0256778f3e` |
| `icons/favicon.svg` | `59d3f1be2c9569afddbae6a944eb023bd2327a06ebfec12bfa28d83def7e149e` |
| `pwa/site.webmanifest` | `57299027481c4cfa0550bbe69849ba7f9bcf708d94c8a8d5d39bec847b9545d6` |
| `social/og-image.png` | `e576186bc924f21b930a01f3cf2466b19082434f643339b48521f29f3c8f7f0a` |

## Estado da integração no reboot

A fundação visual integra primeiro os assets SVG que podem permanecer byte-for-byte e ser auditados automaticamente.

Assets runtime atualmente esperados em `public/brand/`:

| Runtime | Origem no Brand Pack | SHA-256 oficial | Uso |
| --- | --- | --- | --- |
| `tda-icon-duck-black.svg` | `icons/tda-icon-duck-black.svg` | `10ccb252143ebb50e57de27d9704cf801d6811f4bd21e290a31d56ac4ae6f6f6` | ícone compacto em fundo claro |
| `tda-icon-duck-white.svg` | `icons/tda-icon-duck-white.svg` | `8702b24c58d28fa5f217531edd6fd458333a88f26fd14662e6f8ca190882cdac` | ícone compacto em fundo escuro |
| `tda-mark-black.svg` | `logos/tda-mark-black.svg` | `66c5dbe83c07b08e6355230c255ee98fd27f4ef1ce93e4de2cce239e9217a5ec` | símbolo principal em fundo claro |
| `tda-mark-white.svg` | `logos/tda-mark-white.svg` | `8474cd455cb5b6ffc254ed5ca5c3c5aa1b25f64ec8e694ed85ce1eea8b2d83ff` | símbolo principal em fundo escuro |
| `favicon.svg` | `icons/favicon.svg` | `59d3f1be2c9569afddbae6a944eb023bd2327a06ebfec12bfa28d83def7e149e` | favicon adaptativo |

`tools/check-design-system.mjs` valida esses hashes em toda execução de `pnpm check`. Alterar silenciosamente um desses masters passa a quebrar CI.

O header do reboot usa o **mark oficial** com variante black/white real conforme tema. Não usa `filter: invert()` como substituto permanente de master.

### Binários ainda não integrados nesta fase

Permanecem pendentes para uma entrega própria de assets binários:

- horizontal white/black;
- stacked white/black;
- favicon ICO/PNGs;
- Apple Touch;
- Android/PWA/maskable;
- `site.webmanifest` e `browserconfig.xml` quando seus assets referenciados existirem no runtime;
- Open Graph/Twitter cards.

A aplicação **não aponta para manifest ou PNG ausente** enquanto essa importação não for concluída. O favicon SVG oficial já pode ser usado com segurança.

## Estrutura oficial do pacote

### `source/`

Masters aprovados. Não são para manipulação casual nem para serem regenerados a partir de derivados.

Inclui:

- `tda-icon-duck-white-master.png`;
- `tda-icon-duck-black-master.png`;
- `tda-logo-black-master.png`;
- `tda-logo-white-master.png`.

### `logos/`

Lockups e símbolo principal para uso de interface.

Principais:

- `tda-stacked-white.png`;
- `tda-stacked-black.png`;
- `tda-horizontal-white.png`;
- `tda-horizontal-black.png`;
- `tda-mark.svg`;
- `tda-mark-white.svg`;
- `tda-mark-black.svg`.

### `icons/`

Favicons, ícones do pato, Apple Touch, Android/PWA, Safari e tiles.

### `social/`

- `og-image.png`;
- `og-image-dark.png`;
- `og-image-light.png`;
- `twitter-card.png`.

### `pwa/`

- `site.webmanifest`;
- `browserconfig.xml`.

## Regras de uso

1. Não alterar proporções.
2. Não redesenhar o pato.
3. Não misturar masters claro/escuro no mesmo lockup sem motivo funcional.
4. Não adicionar glow, bevel, sombra ou gradiente ao master.
5. Em tamanho pequeno, preferir o ícone do pato ao lockup completo.
6. Escolher a variante de maior contraste para o fundo.
7. O Design System pode definir espaço, tamanho, placement e estados de UI; não modifica a geometria da marca.

## Escolha por contexto

| Contexto | Asset recomendado |
| --- | --- |
| header/navbar desktop | `tda-horizontal-*` quando o binário oficial estiver integrado; até lá mark oficial + wordmark textual |
| hero/institucional | `tda-stacked-*` ou `tda-horizontal-*` |
| sidebar compacta | `tda-mark-*` ou pato isolado |
| favicon/app | pato isolado / favicon oficial |
| PWA | assets Android/maskable oficiais |
| Open Graph | `social/og-image.png` como default |
| fundo claro | variantes black |
| fundo escuro | variantes white |
| arte/fundo complexo | variante que preserve maior contraste |

## Destino no reboot

O próprio pacote recomenda copiar a estrutura para `public/brand/`. Esse continua sendo o destino alvo do TDA.

Estrutura esperada no estado final:

```text
public/brand/
  source/
  logos/
  icons/
  social/
  pwa/
  docs/        # opcional no runtime; masters/docs permanecem preservados na origem
```

Durante a migração incremental, alguns SVGs estão temporariamente no primeiro nível de `public/brand/` para não quebrar consumidores existentes. A reorganização física deve ocorrer junto da importação binária completa, com ajustes de paths na mesma PR.

Para produção, podemos manter apenas assets usados pelo site em `public/brand`, desde que o pacote oficial original e seus checksums permaneçam preservados como fonte de auditoria fora do bundle público.

## Migração para `Faysk/tda`

A importação física completa é uma entrega separada porque contém assets binários.

Critérios:

- cópia byte-for-byte dos arquivos escolhidos;
- verificação SHA-256 contra o pack oficial;
- atualização de metadata/favicon/manifest/OG;
- nenhuma otimização destrutiva nos masters;
- versões derivadas otimizadas, se necessárias, têm nome e origem registrados;
- `next/image` para imagens raster de conteúdo quando aplicável;
- SVG oficial permanece sem redesenho.

## Brand no World Explorer

A marca deve enquadrar o explorador, não competir com o grafo.

- sidebar pode usar mark/lockup compacto;
- topbar não repete a marca se a sidebar já a estabelece;
- dourado de marca não significa que todo node ou edge deva ser dourado;
- cores semânticas de relação/status pertencem ao sistema de visualização, não à geometria da marca.

## O que não fazer

- recriar a marca por CSS;
- traçar manualmente um SVG parecido;
- gerar novo pato por IA para substituir o símbolo oficial;
- usar screenshot da marca no lugar dos masters;
- sobrescrever favicon com artwork de sessão;
- colocar nome antigo `DND FAYSK.DEV` como identidade do reboot.
