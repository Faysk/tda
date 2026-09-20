# Dívida de mídia ainda versionada no Git — 2026-09-20

> Status: inventário vigente de dívida técnica
> Owner: integrations/media + operations
> Última revisão: 2026-09-20
> Fonte de verdade: árvore de `main` no commit `834dc6d122f2a0cbc88eafc4b10c84240ec88129`, ADR-0018 e consumers inspecionados

## Regra

Toda mídia persistida/publicada pertence ao **Media Storage**. O provider atual é Cloudflare R2.

Git mantém código, markup, manifests, metadata, hashes, migrations, tooling e documentação. Bytes de imagem/áudio/vídeo, inclusive SVG, favicon e mídia codificada em base64, não são destino canônico do repositório.

Este documento existe porque a implementação atual ainda não cumpriu totalmente essa regra.

## Snapshot real do repositório

A árvore atual contém:

- **55 arquivos de mídia** com extensão visual/mídia;
- **18 blobs `.b64`** que representam bytes de imagem codificados como texto;
- **73 artefatos de mídia** no Git no total.

Mudar a extensão para `.b64` não transforma mídia em código.

### Distribuição

| Área | Quantidade | Estado observado | Destino correto |
| --- | ---: | --- | --- |
| `media/sources/astel/` | 16 | cópia source usada pela Media Pipeline v1; runtime já consome R2 | remover do Git após pipeline deixar de exigir source local; master/origem em private, derivado público em public |
| `media/sources/noah/` | 8 | cópia source usada pela Media Pipeline v1; runtime já consome R2 | mesmo tratamento de Astel |
| `public/lore/pipipi/` | 21 | 18 derivados AVIF possuem consumer runtime confirmado; 3 `*-static.avif` precisam de confirmação de consumer antes de remoção | derivados públicos em `tda-media-public`; masters/origens em private |
| `public/lore/d/` | 20 | favicon local ainda consumido; imagens narrativas do runtime já usam R2; 1 PNG + 18 blobs/base64 são resíduos de pacote/source sem consumer runtime encontrado na inspeção do diretório | favicon/derivados públicos em public; masters/source em private; resíduos sem consumer removidos após gate |
| `public/brand/` | 5 | favicon + marks black/white possuem consumer confirmado no layout; duck icons exigem confirmação de consumer | derivados de marca públicos em public; masters de marca em private |
| `public/diario/astel/` | 1 | favicon local confirmado em `index.html` e `leitura.html` | public |
| `public/lore/yllith/` | 1 | favicon local confirmado; imagens narrativas já usam R2 | public |
| `local-companion/tda_companion/ui/` | 1 | ícone SVG versionado junto do aplicativo; consumer/package precisa ser mapeado antes de retirada | master em private; build/package materializa derivado necessário sem usar Git como storage |

Total: **73**.

## O que já está conforme

Consumers inspecionados já usam `https://media.dnd.faysk.dev` para:

- Astel — 16 assets publicados/verificados;
- Noah — 8 assets publicados/verificados;
- D — imagens narrativas principais;
- Yllith — imagens narrativas e social;
- parte da experiência cinematográfica de Pipipi.

A repair release de Astel/Noah está registrada em [evidência estruturada](evidence/astel-noah-media-repair-2026-09-20.json).

## O que ainda viola o contrato

### 1. Pipipi

`src/features/lore/components/pipipi-lore-page.tsx` ainda referencia diretamente:

```text
/lore/pipipi/*.avif
```

Esses bytes são servidos pelo deployment web e precisam migrar para `tda-media-public`.

### 2. Brand

`src/app/layout.tsx` ainda referencia:

```text
/brand/favicon.svg
/brand/tda-mark-white.svg
/brand/tda-mark-black.svg
```

A presença em `public/brand` é compatibilidade, não arquitetura final.

### 3. Favicons standalone/diário

D, Yllith e o diário de Astel ainda usam favicons locais. Favicon é mídia e segue a mesma regra de Media Storage.

### 4. Sources Astel/Noah

Os 24 objetos públicos já estão no R2, mas os manifests ainda apontam para `media/sources/*` porque a Media Pipeline v1 exige source local no Git.

### 5. Pacote D / base64

O diretório de D contém bytes de imagem e chunks base64 que não devem permanecer como storage histórico dentro do Git. A retirada exige confirmar consumer, provenance e rollback, mas o destino final continua sendo R2 ou remoção quando o arquivo não tiver mais função.

## Bloqueio técnico atual — Media Pipeline v1

`tools/media/pipeline.mjs` ainda valida que todo `asset.source`:

```text
comece com media/sources/
```

e lê os bytes do filesystem do checkout antes de publicar.

Isso conflita com ADR-0018. Portanto:

- `media/sources/` é mecanismo legado/transitório;
- não é o contrato para nova mídia;
- não adicionar novos bytes ao Git para contornar a ausência de intake;
- se uma nova entrega exigir mídia antes da migração da pipeline, corrigir o intake/pipeline primeiro ou usar uma operação R2 explicitamente autorizada e documentada, sem transformar o Git em storage.

## Fluxo alvo por propósito

```text
fonte de trabalho local temporária
        |
        v
private R2
(master/origem preservada)
        |
        +--> preview R2
        |    (homologação/candidato temporário)
        |
        v
manifest + hashes + metadata no Git
        |
        v
pipeline autorizada
        |
        v
public R2
(derivado aprovado, imutável)
        |
        v
consumer
```

### `tda-media-private`

Usar para:

- masters;
- originais;
- fontes de geração;
- material editorial/pending que precisa ser preservado;
- inputs canônicos não públicos.

### `tda-media-preview`

Usar para:

- homologação;
- candidatos temporários;
- validação de upload/derivados;
- objetos que ainda não são publicação canônica.

### `tda-media-public`

Usar somente para:

- derivados aprovados;
- assets efetivamente públicos;
- social cards públicos;
- imagens/áudio/vídeo que podem ser entregues anonimamente pelo domínio público.

## Ordem de migração

1. **Media Pipeline / intake** — parar de exigir bytes em `media/sources` e aceitar source no boundary private/preview com hash/metadata no Git.
2. **Pipipi** — mover os 18 assets runtime confirmados para public R2; investigar/remover os 3 `*-static.avif` se órfãos.
3. **Brand + favicons** — publicar derivados no R2 e trocar consumers antes de apagar os locais.
4. **Astel/Noah sources** — retirar as 24 cópias do Git depois da pipeline nova, preservando hash/manifest/provenance.
5. **D** — remover blobs/base64 sem consumer e migrar favicon; preservar somente o que tiver função comprovada.
6. **Companion icon** — definir materialização no build/package a partir do Media Storage sem quebrar funcionamento offline do aplicativo instalado.

Cada fase exige consumer atualizado, read-back quando aplicável, teste e rollback antes de apagar o byte do Git.

## Regra para novas mudanças

**Nenhuma nova mídia deve aumentar este inventário.**

PR que introduza novo `.png`, `.jpg`, `.webp`, `.avif`, `.svg`, áudio, vídeo ou blob equivalente no Git precisa ser bloqueada ou acompanhada de uma exceção arquitetural explícita aprovada. O objetivo é a contagem cair de 73 para zero, não crescer.
