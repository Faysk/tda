# Astel e Noah — integração e publicação

> Status: publicado e verificado em Production
> Owner: frontend / integrations/media / editorial
> Última revisão: 2026-09-20

## Estado atual — 2026-09-20

A integração deixou de ser candidata.

- Astel está publicada em `/lore/astel`;
- Noah está publicada em `/lore/noah`;
- os 24 assets públicos (16 Astel + 8 Noah) foram publicados no `tda-media-public`, lidos de volta e verificados por `media.dnd.faysk.dev`;
- a primeira execução com credenciais válidas registrou `published=24`, `verified=24`;
- após correção do wrapper de receipt, o retry registrou `reused=24`, `verified=24`;
- Production foi promovida com sucesso e o fluxo posterior passou a retornar `media_publish=false` quando não havia nova mídia pendente.

Evidência: [Astel/Noah media repair — 2026-09-20](../integrations/evidence/astel-noah-media-repair-2026-09-20.json).

Os 24 bytes source ainda presentes em `media/sources/astel` e `media/sources/noah` **não são storage canônico**. Permanecem apenas porque a Media Pipeline v1 exige source local; fazem parte da [dívida de mídia no Git](../integrations/media-git-debt-2026-09-20.md).

A preservação de masters no bucket privado não foi comprovada por esta repair release e não deve ser inferida do sucesso do bucket público.

## Identificação e decisão editorial

Recebimento das pastas fornecidas pelo usuário, seguindo [ZIP à produção](../operations/zip-to-production.md) e o [modelo de entrega](../templates/lore-pack-delivery.md). Não foi recebido ZIP; as fontes continuam em `.local`, com a alteração editorial de título autorizada. Nenhum conteúdo privado de trabalho foi incluído na integração.

| Lore | Fonte local | URL solicitada | Listagem |
| --- | --- | --- | --- |
| Astel — Antes da Voz | `.local/Astel_Antes_da_Voz` | `/lore/astel` | Sim, explicitamente solicitada |
| Noah Wood — Sonhos com Dentes | `.local/Noah_Sonhos_Com_Dentes` | `/lore/noah` | Sim, explicitamente solicitada |

Entrega implementada: `standalone`, preservando o HTML/CSS/JS fornecido e sua identidade visual, conforme [arquitetura de entrega](lore-delivery-architecture.md). O catálogo editorial associa apenas tipo `pc` e slugs exatos `astel`/`noah`, sem matching por nome, aliases ou criação de campanha, entity ou relation. Não foi consultado nem alterado o banco de produção. Canonical próprio; não foi copiado o `noindex` de D/Yllith.

## Inventário observado

| Pacote | Arquivos | Imagens usadas | Bytes das imagens | Dimensões encontradas |
| --- | --- | --- | --- | --- |
| Astel | 20 | 15 PNG | 38.053.951 | 1536×1024, 1484×1060, 1024×1536, 1060×1484, 1059×1484 |
| Noah | 12 | 7 PNG | 16.681.258 | 1086×1448 |

Cada pacote contém `index.html`, `styles.css`, `script.js`, README e um Markdown de origem narrativa. Todas as 22 imagens decodificaram com Sharp instalado na árvore do Next. Foram calculados bytes, SHA-256, dimensões, alpha e consumidores por arquivo; inventário detalhado em `.local/astel-noah-inventory.json`, mantido local. Não há referência de arquivo ausente nem âncora interna quebrada nas referências inspecionadas. CSS contém SVG técnico embutido para textura; favicon também é SVG embutido. Fontes usam a pilha do sistema, sem download externo declarado. Scripts implementam progresso, capítulos, menu e galeria, sem dependência remota declarada.

As 22 imagens foram convertidas para WebP lossless, sem resize: 54.735.209 bytes originais → 38.627.950 bytes, redução de 29,4%. A comparação dos pixels RGBA decodificados passou para todos os pares. Duas imagens sociais PNG 1200×630 foram preparadas diretamente dos originais, com `contain`, sem corte nem ampliação. Total novo: 24 assets / 40.753.304 bytes. Parâmetros, hashes, provenance, dimensões, consumidores e URLs candidatas estão no [inventário de preparação](../integrations/evidence/astel-noah-preparation-2026-09-19.json).

Preloads, `src` e `data-full` da galeria apontam para as mesmas keys imutáveis declaradas pelos manifestos. A preparação não é comprovação de entrega R2: os URLs só devem ser promovidos pela Production CD após upload/read-back/verificação pública. O Markdown de origem não é carregado pelo runtime e continua local, fora do manifesto público.

## Integração e ligações implementadas

| Superfície | Trabalho |
| --- | --- |
| Páginas independentes | HTML/CSS/JS em `public/lore/astel` e `public/lore/noah`; URLs de CSS/JS absolutas para funcionar sem barra final, com barra e com `/index.html`. |
| Roteamento | `next.config.ts` combina as duas entradas do catálogo com os rewrites antigos. `standaloneNoindexLores` permanece restrita a D/Yllith. |
| Catálogo `/lore` | Cards de Astel e Noah com títulos, resumos e capas dos manifestos. Pipipi permanece; D/Seika/Yllith continuam fora. Navegação de documento por `a` para as standalone. |
| Home e navegação geral | A home já usa `LoreHomeEntry` com link para `/lore`; a descoberta das novas lores passa pelo catálogo. Não exige um item de menu global por personagem. |
| Retorno das lores | “Explorar outras lores” no rodapé, preservando voltar ao topo. |
| Perfis dos personagens | `LorePage` oferece “Ler a história” para `pc` com slug exato do catálogo, inclusive quando não há outras seções. `/personagens/<slug>` e seu conteúdo permanecem. |
| World Explorer | Ação adicional no inspector para `kind=entity`, `entityType=pc` e slug exato do catálogo; indisponível durante edição, como as demais ações de navegação. Não substitui `selected.route` nem altera dados. |
| Compartilhamento | Canonical, og:url/type/locale/image/dimensões/alt e Twitter card adicionados. Titles, descriptions e favicons autorais preservados. |
| Diário de Astel | Link da lore para `/diario/astel` e do rodapé do livro para `/lore/astel`. O capítulo `#livro` continua sendo a seção narrativa interna original. |
| Release | Smoke da Production CD inclui `/lore`, `/lore/astel` e `/lore/noah` antes da promoção. Nenhum workflow foi disparado nesta preparação. |
| Sitemap | Não foi encontrada implementação de sitemap neste checkout. Criar um sitemap geral não é requisito para adicionar estas duas rotas. |

A branch atual passou a incluir o diário em `public/diario/astel`, seu catálogo e rewrite. A ligação usa essa rota implementada; não publica material adicional de `.local/livro-astel`.

Por decisão do usuário em 2026-09-19, o título “Notas do DM” foi substituído por “Perguntas sem resposta” nos dois HTMLs locais, removendo o subtítulo “spoilers e perguntas em aberto”. As perguntas e o comportamento de expansão foram preservados. A alteração editorial está aplicada à versão publicada.

Revisão após o preview: os títulos de ganchos, que já vieram assim nos originais, foram trocados a pedido do usuário. Astel usa “Algumas perguntas ainda respiram no escuro.”; Noah usa “Algumas respostas ainda mordem.”. O card de Noah passou a consumir a arte vertical WebP já declarada no manifesto, com `contain` e sem zoom no hover, em vez da imagem social horizontal. A imagem social e suas URLs de compartilhamento permanecem próprias; não foi necessário gerar nem publicar novo asset.

## Fases, evidências e pendências

- [x] Fontes locais preservadas; arquivos, consumidores e âncoras inventariados.
- [x] As 22 imagens decodificadas; bytes, hashes e dimensões calculados.
- [x] Rotas pretendidas e decisão de listagem registradas; pontos de ligação inspecionados no código.
- [ ] Masters preservados em R2 privado com read-back.
- [x] Derivados preparados, pixels conferidos e inspeção visual local realizada.
- [x] Objetos públicos com read-back/GET/decode pela Production CD.
- [x] HTML/CSS/JS, catálogo, metadados e ligações editoriais implementados localmente.
- [x] Desktop/mobile, capítulos, menu, galeria, teclado, redução de movimento e ausência de JS conferidos no navegador.
- [x] `pnpm check`, `pnpm build` e testes de navegador pertinentes executados para o candidato.
- [x] PR/merge, publicação deliberada, `/api/version` e consumers públicos verificados.

### Nota histórica sobre o intake usado nesta entrega

Em 2026-09-19, a Media Pipeline v1 exigia fontes em `media/sources/` acompanhadas de manifestos em `media/manifests/`. Esse foi o mecanismo usado para Astel/Noah e explica por que os 24 sources ainda existem no Git.

ADR-0018 posteriormente tornou essa dependência dívida explícita: **nova mídia não deve usar Git como storage**. O intake precisa migrar para private/preview R2 mantendo no Git apenas manifest/hash/metadata/provenance. Não copiar o caminho de Astel/Noah para novas entregas.

Verificação local: `pnpm media:validate` passou para o manifesto existente (14 assets, 602.518 bytes), e os seis testes de `tools/media/pipeline.test.mjs` passaram. Isso confirma o caminho de contribuição e os checks locais; não comprova disponibilidade dos secrets remotos nem upload das imagens de Astel/Noah. Nenhum deploy ou upload foi executado. O publisher inspecionado entrega ao bucket público; a preservação de masters/pacotes no privado continua sendo uma etapa operacional separada, não coberta automaticamente por esse manifesto público. Preservar as fontes locais até a conclusão dos gates de mídia e da entrega.

## Recibo e rollback

A publicação pública foi concluída e possui receipt versionado. O fluxo de reparação envolveu #414 (convergência do publisher), #415 (repair manifests) e #417 (wrapper retry-safe). A evidência final registra baseline, runs, contagens e Production promovida.

A preservação privada dos masters continua separada e não é dada como concluída sem receipt próprio.

Validação local: build concluído; check completo passou (inclui typecheck, lint, unitários, contratos de mídia, diário, design e documentação). A suíte existente possui sete testes ignorados; o teste editorial adicionado não introduz skips. Lint mantém avisos, incluindo especificidade do CSS autoral, sem erro. Testes Playwright de lores + diário: 21 passaram, sem skips, em 1920×1080, 2560×1440 e 390×844. O teste de mídia usa os bytes exatos de `media/sources` via interceptação de rede, explicitamente sem comprovar R2. Após CD, `TDA_VERIFY_PUBLIC_MEDIA=true` desativa a interceptação para validar entrega real.

Capturas e logs locais: `test-results/astel-noah-lore-*`, `.local/lore-catalog-{390,1920,2560}.png`, `.local/astel-noah-check.log`, `.local/astel-noah-build.log`, `.local/astel-noah-e2e.log`. As 22 entradas de galeria foram abertas/decodificadas, com fechamento por Escape; todas as imagens narrativas carregaram. Testados retorno ao catálogo, menu mobile, perguntas expansíveis, aliases de URL, canonical, ausência de headers noindex herdados, fluxo de diário e texto com JS/imagens desativados.

Adaptações técnicas: tipo explícito nos botões da galeria, seção semântica para os termos do pacto, callbacks sem retorno acidental e caminhos/metadados/links descritos acima. CSS mantém a composição autoral, com uma correção de qualidade em desktop: `object-fit: scale-down` nos fundos hero/memória ampliados e no fundo da fazenda de Astel. Antes, alguns chegavam a 2,5×; depois, nenhuma imagem narrativa excedeu 1,15× nos três viewports medidos. Isso mantém o detalhe natural sem inventar resolução; áreas livres usam o fundo escuro existente. Mobile mantém o enquadramento recebido.

Rollback atual: retirar cards/ações/rewrites/páginas pela esteira normal e restaurar a referência anterior. Não apagar objetos R2 imutáveis como primeira resposta e não alterar dados de produção para desfazer navegação.
