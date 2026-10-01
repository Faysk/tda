# Arquitetura de entrega das lores

> Status: decisão aprovada; implementação parcial
> Owner: narrative-memory / frontend / produto
> Última revisão: 2026-10-01

## Objetivo

Padronizar como novas páginas em `/lore/<slug>` são publicadas sem misturar três decisões diferentes: forma de entrega técnica, presença no catálogo `/lore` e vínculo narrativo com campanha/universo.

A URL de uma lore não determina automaticamente se ela pertence à campanha principal. Publicar também não significa listar ou indexar.

## Dimensões independentes

Cada lore deve declarar separadamente:

- `delivery`: como a experiência é servida (`app` ou `standalone`);
- `listed`: se aparece no catálogo `/lore`;
- `campaign`/`universe`: vínculo narrativo confirmado, quando existir;
- `indexable`: se mecanismos de busca podem indexá-la.

Não criar campanha, entity ou relação fictícia apenas para hospedar uma página.

## Dois modos de entrega

### `app` — lore integrada

Usar quando a lore faz parte da aplicação TDA e se beneficia de Next/React, dados estruturados, componentes e integração direta com o produto.

Estrutura típica:

```text
src/app/lore/<slug>/
public/lore/<slug>/   # somente assets técnicos locais deliberados, quando necessários
```

Pipipi permanece neste modelo. A existência de mídia local histórica em uma lore integrada não cria precedente para novas publicações; novos binários editoriais públicos seguem o boundary R2 descrito abaixo.

### `standalone` — microsite editorial

Usar quando a experiência nasce como HTML/CSS/JS autocontido, com identidade visual e comportamento próprios, sem depender do shell do TDA.

Para novas standalone, preferir:

```text
public/
  lore/
    <slug>/
      index.html
      styles.css
      script.js
      reading.css        # quando houver modo Leitura
      reading-mode.js    # quando houver modo Leitura
      favicon.svg        # asset técnico local pequeno, quando fizer sentido

media/
  manifests/
    <slug>.json
  sources/               # somente fontes versionáveis aceitas pela Media Pipeline
```

A URL pública continua `/lore/<slug>`. Quando necessário, usar rewrite de `/lore/<slug>` para `/lore/<slug>/index.html` sem expor essa diferença ao visitante.

## Storage de mídia das lores

Toda mídia editorial pública consumida em runtime por uma lore usa o R2 como storage de entrega: backgrounds, portraits, artwork, mapas, layers de parallax, overlays, social cards, áudio e vídeo. A publicação ocorre pela Media Pipeline compartilhada, com keys imutáveis/content-addressed, read-back e verificação da entrega pública.

O repositório guarda código, markup, manifestos, metadata, tooling e pequenos assets técnicos diretamente acoplados ao documento. `favicon.svg` e SVGs técnicos pequenos podem permanecer locais quando essa escolha for deliberada. Binário editorial local em `public/lore/<slug>/assets` é exceção legada ou explicitamente justificada, não o padrão para novas lores.

Masters, fontes de trabalho e pacotes originais permanecem separados dos derivados públicos e devem ser preservados em storage privado apropriado. O bucket público recebe apenas derivados autorizados para entrega.

Nenhuma lore cria uploader, endpoint operacional ou autorização próprios. A regra é: **a lore declara mídia; a plataforma publica**. Ver [ADR-0014 — R2 como boundary de mídia publicada](../adr/0014-r2-media-storage-and-publishing.md), [Mídia — fluxo único](../integrations/r2/media-pipeline.md) e [Mídia — autorização compartilhada de staging](../integrations/r2/media-access-contract.md).

## Situação atual

| Lore | Delivery | Listada | Vínculo campaign atual | Indexação desejada agora |
| --- | --- | --- | --- | --- |
| Pipipi | `app` | Sim | Sim, conforme o projeto existente | Preservar política pública atual |
| Astel / Noah | `standalone` estática, candidato local | Sim, solicitado | Sem novas entidades/relações; ligações editoriais por slug | Canonical próprio; sem copiar o noindex das lores externas |
| D | `standalone` estática | Não | Binding editorial para `antes-que-seja-tarde`, resolvido somente quando a campaign existir | Não indexar |
| Seika | Route Handler standalone legado | Não | Não | Não indexar; alinhar runtime em entrega própria se necessário |
| Yllith | `standalone` estática planejada | Não | Não | Não indexar |

D e Seika chegaram à produção por estratégias técnicas diferentes. Essa diferença é histórica, não editorial.

- D, em `public/lore/d`, é o modelo mais próximo do padrão novo de entrega da página, mas a política de mídia nova é o boundary R2 acima.
- Seika, em `src/app/lore/seika/route.ts` e rotas auxiliares, continua válida, mas é exceção legada e não deve ser copiada para novas lores.
- Yllith deve inaugurar o padrão standalone estático novo e fazer o cutover de sua mídia para o fluxo compartilhado.

Não migrar Seika apenas por simetria de diretório. Uma migração futura precisa ser uma entrega própria, preservando URL, composição, reading mode, favicon, mídia, comportamento e fidelidade visual.

## Publicação, listagem, vínculo e indexação

Essas decisões não se inferem umas das outras:

- **publicada**: pode ser aberta por URL;
- **listada**: aparece no catálogo `/lore`;
- **vinculada**: pertence a campanha/universo confirmado;
- **indexável**: pode entrar em mecanismos de busca.

D e Seika ficam, no estado atual, públicas por URL, não listadas, sem vínculo com a campaign legado/default e não indexáveis. Yllith permanece planejada: quando for publicada, seguirá o mesmo estado editorial de não listada, sem vínculo com a campaign legado/default e não indexável, salvo nova decisão explícita. `noindex` não é controle de acesso; quem souber a URL de uma lore publicada ainda pode abrir a página.

## Contrato de produção para standalone

Além da identidade específica de cada personagem, novas standalone devem procurar manter:

- canonical próprio em `/lore/<slug>`;
- `title`, `description`, `og:*` e Twitter card próprios;
- favicon/ícone próprio quando houver identidade adequada, declarado no `<head>` sem depender de JavaScript;
- imagem social dedicada/derivada publicada pelo fluxo de mídia, sem apontar para diretório de masters;
- modo Cinemático como experiência principal quando esse for o conceito aprovado;
- modo Leitura quando a experiência cinematográfica resumir, fragmentar ou tornar menos confortável o acesso ao texto completo;
- uma fonte narrativa oficial única para evitar divergência entre Cinemático e Leitura;
- navegação por capítulos coerente entre os modos quando aplicável;
- `prefers-reduced-motion` e alternativa legível à animação;
- mobile tratado como composição própria, não desktop comprimido;
- camadas de parallax preservadas separadamente quando a direção de arte depender delas;
- nenhum vínculo automático com catálogo, campanha, grafo ou entidades.

O comportamento Cinemático/Leitura pode ser consistente entre lores sem compartilhar a mesma estética. O controle pertence visualmente à identidade de cada personagem.

## Registro central leve

A arquitetura prevê um registro versionado e leve para evitar que o estado editorial fique espalhado por `page.tsx`, rewrites e diretórios. Isso não é banco, CMS nem sistema multi-jogo completo.

Campos mínimos esperados:

```ts
{
  slug: "yllith",
  delivery: "standalone",
  listed: false,
  campaign: null,
  universe: null,
  indexable: false,
  title: "Yllith — Nascida para conquistar"
}
```

Esse registro agora vive em `src/features/lore/registry.ts`. Ele separa `delivery`, `listed`, `campaignTechnicalSlug`, `indexable` e `entityLink`; não contém texto narrativo nem cria registros no banco. `src/features/lore/standalone-catalog.json` permanece somente com metadata de apresentação dos cards Astel/Noah. A listagem consulta o registry, e o vínculo entity→standalone é campaign-qualified para que slugs iguais em campaigns diferentes não colidam.

O resolver server-side `standalone-link-repository.ts` só considera o vínculo de campaign existente depois que a row de campaign pode ser resolvida. Para UI pública, badge/nome de campaign só aparece se lifecycle/visibility/public route também forem públicos e válidos; ausência do registry novo não inventa um rótulo “desconhecido”.

## Integração multi-campaign

ADR-0020 aprova múltiplas campaigns, mas o registro de lore continua separando delivery/listagem/vínculo/indexação.

- `campaign: null` permanece válido;
- vínculo usa identidade explícita da campaign e não é inferido de personagem/artwork;
- `/lore/<slug>` continua canonical da lore standalone;
- associar uma lore a campaign não cria entity/canon/session nem muda URL automaticamente;
- nome/public route key da campaign não entra na key de mídia da lore por conveniência;
- catálogo global `/lore` pode continuar curado independentemente de campaign.

A decisão editorial da #1131 aponta D para **Antes que seja tarde**, mas o runtime mantém o vínculo não resolvido enquanto a campaign não existir no registry persistido. Isso não lista D, não muda `/lore/d`, não cria entity/canon/session e não copia conteúdo do microsite.

Multi-jogo/multiuniverso completo continua fora do escopo desta decisão.
