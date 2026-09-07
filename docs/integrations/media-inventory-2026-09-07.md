# Inventário de mídia — 2026-09-07

> Status: auditoria observada
> Owner: integrations/media
> Data da observação: 2026-09-07
> Escopo: reboot `Faysk/tda`, sessões publicadas de `yuhara-main`, Brand Pack documentado e Supabase Storage relacionado

Este documento é uma **fotografia operacional**, não a fonte canônica do estado dinâmico. O banco e os buckets reais continuam sendo a fonte operacional; a política de armazenamento está em [Cloudflare R2](r2.md).

## Resumo executivo

- `public/` do reboot contém somente `public/brand/`.
- Há 5 SVGs oficiais já integrados e versionados no Git.
- O Brand Pack documenta binários oficiais ainda não integrados no runtime.
- Há 11 sessões publicadas com cover + hero, totalizando 22 imagens públicas referenciadas.
- Essas 22 imagens estão distribuídas por três origens legadas/atuais.
- `tda-media-public`, `tda-media-private` e `tda-media-preview` estão criados, mas a migração descrita aqui ainda não foi executada.

## Assets de marca já no repo

| Path | Tipo | Tamanho observado | Destino |
| --- | --- | ---: | --- |
| `public/brand/favicon.svg` | favicon oficial | 1.613 B | manter no Git |
| `public/brand/tda-icon-duck-black.svg` | ícone oficial | 1.487 B | manter no Git |
| `public/brand/tda-icon-duck-white.svg` | ícone oficial | 1.487 B | manter no Git |
| `public/brand/tda-mark-black.svg` | mark oficial | 3.141 B | manter no Git |
| `public/brand/tda-mark-white.svg` | mark oficial | 3.141 B | manter no Git |

Esses masters runtime são protegidos por checksums no Design System e não são candidatos à migração para R2 como dependência de execução.

## Brand Pack documentado e ainda pendente

Categorias já registradas em `docs/design-system/official-assets.md` e ainda não completamente integradas:

- logos horizontal black/white;
- logos stacked black/white;
- favicon ICO/PNGs;
- Apple Touch;
- Android/PWA/maskable;
- `site.webmanifest` e `browserconfig.xml`;
- Open Graph/Twitter cards;
- masters/originais do pacote.

Decisão de destino:

- derivados necessários ao shell/PWA do site: Git/runtime;
- masters e pacote oficial de preservação: candidato a `tda-media-private/brand/official-pack/v1/`, sem consumo runtime direto;
- cards sociais fixos podem permanecer no Git se fizerem parte da versão do app; cards gerados/dinâmicos pertencem ao R2 público.

## Sessões publicadas observadas

| Session UUID | Sessão | Origem atual | Objetos | Prefixo alvo no R2 |
| --- | --- | --- | ---: | --- |
| `caeb376d-0a7d-5bf7-b18a-68c82557b61d` | As Cabeças que Ainda Falam | `dnd.faysk.dev` | 2 | `campaigns/yuhara-main/sessions/{uuid}/` |
| `7cf2c458-2b61-4384-8fb4-b430ff6c56c9` | O Verde Esquisito e a Forja Impossível | `dnd.faysk.dev` | 2 | `campaigns/yuhara-main/sessions/{uuid}/` |
| `abc4ef3c-ddb3-42e5-94d6-023fbab579e8` | O Retorno do Bardo e a Forja do Último Suspiro | `dnd.faysk.dev` | 2 | `campaigns/yuhara-main/sessions/{uuid}/` |
| `7cb15987-8493-4f37-8eae-92c7d6d46a07` | O Caçador Marcado e o Covil dos Licantropos | `dnd.faysk.dev` | 2 | `campaigns/yuhara-main/sessions/{uuid}/` |
| `c45bf33a-3e00-4c67-a162-5b17b6b0d36c` | A Entrada Atrás da Cachoeira | `dnd.faysk.dev` | 2 | `campaigns/yuhara-main/sessions/{uuid}/` |
| `fbbbf955-bdd0-47ad-bdea-f8e6f6a93891` | A Tinta das Memórias | `dnd.faysk.dev` | 2 | `campaigns/yuhara-main/sessions/{uuid}/` |
| `db9a44f5-ad6b-47f4-96e4-e6f1abcaed19` | Fogo Amigo, o Refúgio das Dríades e a Estrela que Não Era Estrela | `raw.githubusercontent.com/Faysk/dnd-scribe` | 2 | `campaigns/yuhara-main/sessions/{uuid}/` |
| `ae674686-041e-4ed1-8a9c-8319cf1639ef` | A Floresta Sem Norte e os Ecos do Passado | Supabase Storage `session-images` | 2 | `campaigns/yuhara-main/sessions/{uuid}/` |
| `1cd97b45-7693-4df0-9fe3-cd90354817e5` | O Gato Prometido e o Coração-Raiz | Supabase Storage `session-images` | 2 | `campaigns/yuhara-main/sessions/{uuid}/` |
| `f0bc73ea-7352-4462-bcf9-17acc8b279a8` | Entre Canções e Raízes Corrompidas | Supabase Storage `session-images` | 2 | `campaigns/yuhara-main/sessions/{uuid}/` |
| `a36fe84e-1868-4c3f-978f-6f26b84d1eab` | O Olho que Devora a Floresta | Supabase Storage `session-images` | 2 | `campaigns/yuhara-main/sessions/{uuid}/` |

### Distribuição

| Origem | Sessões | Imagens |
| --- | ---: | ---: |
| `dnd.faysk.dev/assets/sessions/**` | 6 | 12 |
| `raw.githubusercontent.com/Faysk/dnd-scribe/**` | 1 | 2 |
| Supabase Storage `session-images` | 4 | 8 |
| **Total** | **11** | **22** |

Cada sessão possui uma variante `cover` e uma `hero`.

## Supabase Storage observado

### `session-images`

- público: sim;
- objetos observados: 8;
- formato observado: WebP;
- volume total observado: 2.448.168 bytes;
- corresponde às 4 sessões mais recentes que já usam Storage.

Esses 8 objetos são candidatos à mesma migração para `tda-media-public`; o Supabase continua guardando metadata/referência, mas não precisa permanecer como storage final desses binários.

### `companion-releases`

- público: não;
- objetos observados: 11;
- volume total observado: 1.073.664 bytes.

Esse bucket não faz parte da migração de imagens de sessão. Artefatos do companion têm ciclo de vida diferente e devem ser tratados em contrato próprio antes de qualquer movimentação.

## Target aprovado para as 22 imagens

Para cada sessão:

```text
campaigns/yuhara-main/sessions/{session-uuid}/cover/{sha256-ou-hash-equivalente}.webp
campaigns/yuhara-main/sessions/{session-uuid}/hero/{sha256-ou-hash-equivalente}.webp
```

O hash real será definido somente após leitura do binário. Não inventar hash a partir de URL, filename ou metadata.

## Ordem de migração

1. baixar os 22 binários das origens atuais;
2. calcular SHA-256 e registrar MIME, bytes e dimensões;
3. confirmar que cada objeto renderiza e corresponde à variante esperada;
4. enviar para `tda-media-public` com key canônica;
5. ler do R2 e comparar hash/bytes;
6. registrar o mapping origem -> bucket/key;
7. habilitar uma forma validada de entrega pública;
8. atualizar `coverImageUrl`/`heroImageUrl` no banco de forma reversível;
9. validar Home, arquivo de sessões e detalhe em desktop/mobile;
10. remover `remotePatterns` legados somente quando nenhum registro publicado depender deles;
11. manter origem antiga até o período de validação terminar.

## Critério para considerar a primeira migração concluída

- 22/22 objetos presentes no R2;
- 22/22 hashes verificados após upload;
- 11/11 sessões exibindo cover e hero corretamente;
- banco sem referência publicada para GitHub legado ou `dnd.faysk.dev`;
- Supabase Storage `session-images` sem consumidor publicado antes de qualquer limpeza;
- rollback documentado e testável;
- `next.config.ts` reduzido apenas às origens realmente necessárias.

## Estado desta auditoria

| Etapa | Estado em 2026-09-07 |
| --- | --- |
| inventário de repo | concluído |
| inventário de sessões publicadas | concluído |
| política de destino | definida |
| download/hash dos 22 binários | pendente |
| upload R2 | pendente |
| entrega pública R2 | pendente |
| atualização Supabase | pendente |
| remoção de origens legadas do Next | pendente |
| limpeza de storage/origem antiga | não autorizada antes da validação |

Nenhum objeto, registro de banco ou origem antiga foi alterado durante esta auditoria.
