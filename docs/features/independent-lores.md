# Lores independentes — publicação, liberdade visual e catálogo

> Status: arquitetura aprovada; registry/linkage implementados no código, publicação depende do registry de campaigns
> Owner: narrative-memory / frontend / produto
> Última revisão: 2026-10-03

## Decisão

Cada página individual de lore em `/lore/<slug>` é uma experiência editorial independente. Pode ter composição, cores, tipografia, navegação, ilustrações, animação e linguagem próprias. Não é obrigada a reproduzir o Design System, header, footer ou template visual do site principal. Reutilização é uma opção, não uma condição para publicação.

A liberdade vale também para Pipipi. Seu desenho existente é um resultado editorial específico, não um molde obrigatório para D, Seika ou futuras lores. Propostas visuais continuam sendo apresentadas em imagem para avaliação, representando a identidade daquela lore.

Independência editorial não exige novo repositório, projeto Vercel, banco ou aplicação. A infraestrutura pode continuar compartilhada. CSS, scripts e efeitos próprios devem ficar isolados para não alterar outras páginas ou a administração.

A forma de entrega técnica agora possui uma decisão complementar: lores integradas ao app e microsites standalone são categorias diferentes de implementação, independentes de listagem, campanha e indexação. O padrão, inventário atual de D/Seika/Pipipi/Yllith e regras para novas standalone estão em [Arquitetura de entrega das lores](lore-delivery-architecture.md).

## Publicar não é listar nem vincular à campanha

São decisões separadas:

| Decisão | Significado |
| --- | --- |
| Publicação | A página pode ser aberta pela sua URL e compartilhada |
| Listagem | Inclusão editorial explícita no catálogo `/lore` |
| Vínculo narrativo | Pertencimento confirmado a uma campanha ou universo |

Criar uma rota ou subir seus arquivos não a inclui automaticamente no catálogo, no grafo ou no cânone da campanha principal. Não criar entity, relation ou campanha fictícia apenas para hospedar a página.

Estado editorial definido para o momento:

| Lore | Listagem em `/lore` | Vínculo campaign atual |
| --- | --- | --- |
| Pipipi | Preservar entrada existente | Não inferir novos vínculos desta decisão |
| Astel e Noah | Listar; inclusão explicitamente solicitada, preparada localmente | Ligações editoriais por slug de personagem, sem criar dados narrativos |
| D | Listar no catálogo curado | Binding editorial explícito para `antes-que-seja-tarde` (display atual `Passos Retomados`); não cria entity/canon/session |
| Seika | Listar no catálogo curado | Binding editorial para `antes-que-seja-tarde`; não cria entity/canon/session |
| Yllith | Listar no catálogo curado | Binding editorial explícito para `antes-que-seja-tarde` (display atual `Passos Retomados`); não cria entity/canon/session |
| Futuras lores independentes | Não listar automaticamente; inclusão exige escolha editorial | Não assumir vínculo |

`/lore` permanece um catálogo curado do site, sujeito ao seu Design System. As páginas individuais têm liberdade visual. A presença de um arquivo em uma pasta não é critério de inclusão no catálogo.

Não listado não significa privado: quem possui a URL pode acessá-la. Esta decisão não impõe autenticação nem `noindex`; políticas de mecanismos de busca e sitemap são escolhas separadas, não inferidas da ausência de um card em `/lore`. A política de indexação desejada para D, Seika, Yllith e futuras standalone externas está registrada separadamente na arquitetura de entrega.

## Contratos compartilhados que permanecem

- texto oficial e ordem narrativa aprovados, sem inventar fatos;
- título, descrição, canonical e imagem social próprios quando houver arte, mesmo sem listagem;
- mídia íntegra, proporção preservada e qualidade perceptível conforme [variantes e crops](../integrations/r2/variants-and-crops.md);
- leitura e navegação acessíveis, adaptação a telas menores e alternativa a movimento excessivo;
- carregamento com falhas compreensíveis, sem esconder a história porque uma imagem falhou;
- nenhuma exposição de segredos ou material privado;
- publicação validada separadamente da implementação.

Acessibilidade e integridade não prescrevem uma estética. Uma abertura cinematográfica pode fazer parte da narrativa; regras do hub administrativo não devem ser usadas para forçar todas as lores ao mesmo formato.

## Baseline comportamental Cinemático ⇄ Leitura

A lore de **D** em `/lore/d` é a baseline aprovada para o comportamento de alternância entre apresentação Cinemática e Leitura. Isso **não** transforma cores, tipografia, arte, composição ou ritmo visual de D em template para outras histórias. A identidade continua pertencendo a cada lore.

O exemplo reutilizável pequeno vive em `public/lore/shared/view-mode-continuity.js`. D e Yllith consomem o mesmo contrato de continuidade sem compartilhar CSS ou direção de arte. Novas lores podem reutilizar o helper ou implementar comportamento equivalente, desde que preservem os invariantes abaixo.

### Invariantes da troca de modo

- o modo padrão é uma decisão explícita por lore; D e Yllith iniciam em **Cinemático**;
- preferência de modo não é global nem persistida por acidente. Um hint descartável pode usar `sessionStorage`, mas não representa preferência do usuário;
- o controle de troca é explícito, acessível por teclado/touch, possui nome/estado perceptíveis e recupera o foco depois da transição;
- a troca preserva o capítulo correspondente **e a posição relativa aproximada dentro dele**, em vez de voltar ao topo da história;
- Leitura mantém a fonte narrativa integral aprovada; Cinemático pode adaptar composição e ritmo, nunca reescrever o cânone;
- `prefers-reduced-motion: reduce` remove transições não essenciais sem perder conteúdo, navegação ou a troca de modo;
- quando a página foi aberta a partir do catálogo `/lore` na mesma origem, o link de retorno preserva a query (`search`) do catálogo. Acesso direto continua retornando simplesmente a `/lore`; isso permite preservar filtros de campanha presentes ou futuros sem criar um contrato de query específico dentro da lore;
- mídia editorial continua no Media Storage/R2, com masters, proporção, qualidade e carregamento controlados pelo pipeline existente.

### Aceite mínimo para uma nova lore com os dois modos

O receipt deve provar o round-trip **Leitura → Cinemático → Leitura** (ou o inverso, conforme modo padrão) no meio da história, verificando capítulo, posição aproximada, texto e foco. Cobrir teclado e touch, 320 px, 390 px, desktop, proxy determinístico de 200% zoom e reduced motion. Screenshots ajudam a comparar composição, mas não substituem asserções de texto, foco, overflow, estado do switch e continuidade narrativa.

## Registro por lore e aceite

O documento dono de cada lore registra: slug/URL, fonte oficial, responsável, identidade visual/referência aprovada, vínculo narrativo conhecido ou ausente, decisão de listagem, assets/manifesto e evidência da publicação. São requisitos documentais; não introduzem schema ou nova plataforma nesta entrega.

- [ ] Página funciona por acesso direto, sem depender do catálogo ou da presença de uma campaign vinculada.
- [ ] Listagem corresponde à decisão editorial vigente; Seika, D e Yllith aparecem no catálogo curado conforme #1285/#1286.
- [ ] Identidade visual da própria lore foi avaliada.
- [ ] Imagens carregam, decodificam e preservam proporções e detalhes nas superfícies reais.
- [ ] Preview do link representa a página individual.
- [ ] Estilos e scripts não afetam outras rotas.

## Curadoria #1286 — D e Yllith

A decisão de 2026-10-03 torna **D** e **Yllith** descobríveis em `/lore` sem reescrever narrativa, mover mídia, criar entidades ou mudar seus canonicals. A campaign vinculada permanece privada; por isso o catálogo público mostra somente metadata que já pertence às próprias lores e **não** publica badge, route key ou nome de campaign enquanto a projection pública da campaign não autorizar isso.

Fontes aprovadas reutilizadas:

- **D** — slug/canonical `/lore/d`; experiência em `public/lore/d/index.html`; fonte narrativa versionada em `public/lore/d/historia-1.md` a `historia-4.md`; card social/cover já referenciado pela página em `https://media.dnd.faysk.dev/lore/d/30f853af30136239f0559cfe6e300949f6be1c0667cd4bd866e8c458eff01052/d-completo.png`; favicon com receipt em `media/manifests/d-ui.json`.
- **Yllith** — slug/canonical `/lore/yllith`; experiência em `public/lore/yllith/index.html`; fonte narrativa versionada em `public/lore/yllith/historia.md`; social/cover `https://media.dnd.faysk.dev/lore/yllith/b9858046c31ddc338fafe822b8c6132d4b4a4383c5f11b7b6e536943f8509f48/social-yllith.jpg`; mídia canônica registrada em `media/manifests/yllith-recovered-batch-1.json` e favicon em `media/manifests/yllith-ui.json`.

O vínculo editorial dos dois usa a chave técnica estável `antes-que-seja-tarde`. O nome humano é resolvido da campaign persistida e, no estado aprovado desta entrega, é **Passos Retomados**. Como a campaign está privada, `resolveStandaloneLoreCampaignLink` mantém o vínculo interno mas devolve `publicCampaign = null`; o card não expõe nome, slug público ou technical slug da campaign. D e Yllith continuam `indexable=false`/noindex mesmo estando listados no arquivo do TDA. O gate de catálogo faz GET e decode das covers canônicas em mobile e desktop, portanto referência quebrada bloqueia a entrega.

## Multi-campaign

A arquitetura multi-campaign agora é aprovada por ADR-0020, mas **lore standalone continua uma exceção editorial independente**:

- uma lore pode ter `campaign = null`;
- vínculo com campaign é metadata editorial explícita, não inferência pela URL, personagem ou artwork;
- `/lore/<slug>` permanece canonical próprio e não ganha campaign no path por obrigação;
- vincular uma lore não cria entity, relation, canon ou session;
- remover/alterar vínculo não move seus assets automaticamente;
- listagem em `/lore`, vínculo de campaign e indexação continuam decisões independentes.

A #1131 estabeleceu o contrato de vínculo; a #1286 conclui a curadoria de D e Yllith no registry. D, Seika e Yllith usam `antes-que-seja-tarde` somente como identidade técnica estável da campaign **Passos Retomados**. D/Yllith ficam `listed=true` sem mudar `/lore/d` ou `/lore/yllith`, continuam não indexáveis e não recebem entity, relation, canon ou session por consequência do vínculo. Enquanto a campaign permanecer privada, o catálogo não publica badge nem rota dela.

## Futuro fora do escopo

Multi-campaign não implica multi-jogo/multiuniverso completo, CMS genérico ou novo mecanismo de permissões para cada lore. Essas expansões continuam decisões separadas.

- [Arquitetura de entrega das lores](lore-delivery-architecture.md) — padrão `app` vs `standalone`, estado atual e evolução futura.
- [Do ZIP à produção](../operations/zip-to-production.md) — integrar a experiência aprovada e registrar adaptações.
