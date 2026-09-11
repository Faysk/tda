# Roadmap

> Status: vigente
> Owner: produto / arquitetura
> Última revisão: 2026-09-11
> Fonte de verdade: `Faysk/tda@main`, `feature-catalog.md`, documentos donos, `delivery/inventory.md` e `operations/deployments.md`

Este roadmap coordena **ordem, dependências e prioridade de produto**. Ele não substitui as specs nem os runbooks donos de cada área. O [inventário de entregas](delivery/inventory.md) é o registro operacional único de estágio/evidência; aqui ficam somente prioridade, direção e dependências entre frentes.

Estágio de entrega segue [Documentação viva](documentation/README.md): branch/PR, validação, integração em `main` e publicação/aplicação são estados diferentes. `main = Production` descreve a linha de código aceita, mas não existe auto-deploy e merge não comprova aplicação externa.

## Base observável e prioridade atual

A `main` consultada nesta revisão está em `ad6d9334471c93a591660e9dc8089e102fc4638a`. Para este corte existe evidência direta de publicação: o deployment Vercel `dpl_FyLWMwVXm4rwGV23khpQkb5qHStU` está `READY`, target `production`, e registra esse mesmo source SHA em metadata. A rota oficial `https://dnd.faysk.dev/lore/pipipi` respondeu HTTP `200` em 2026-09-11. Isso resolve a proveniência do artefato observado neste corte sem inferir o conteúdo atual do campo `commit` de `/api/health`, que continua um contrato separado.

A importação permanece integrada no repositório mas sua ativação/aplicação externa continua um gate separado. Da mesma forma, migration integrada não é tratada como migration aplicada. Estados concretos e evidências ficam no [inventário](delivery/inventory.md) e nos documentos operacionais donos.

### Estabilização antes da publicação — #102

A rodada [#102](https://github.com/Faysk/tda/issues/102) é um gate de **estabilização**, não uma nova frente de produto: corrige defeitos reproduzíveis, regressões visuais/acessibilidade e acabamento sobre os contratos existentes. Ela não altera a ordem P1/P2/P3 abaixo, não promove feature incompleta e não transforma proposta em correção aplicada. Prancheta mantém estágio/evidência no [inventário](delivery/inventory.md); Foguete consolida os gates do candidato; Marreta/Lupa fazem validação independente. Publicação continua deliberada e só pode ser declarada por evidência do SHA candidato e da operação correspondente.

### Prioridade de produto — rodada #99

1. **P1 — Pipipi oficial / Pipoca — publicada.** Pipipi é a lore pioneira e o gate de publicação da rodada [#99](https://github.com/Faysk/tda/issues/99) foi cumprido em production em 2026-09-11. A implementação reutiliza [Perfis editoriais](features/entity-profiles.md), [Design System](design-system/README.md), [superfícies públicas](design-system/public-surfaces.md), metadata pública central e mídia elegível. Estrutura visual/cinematic existente continua sendo **referência**, não um novo contrato visual: tokens, Brand Pack e componentes vigentes permanecem canônicos. Parallax foi tratado como progressive enhancement, respeitando reduced motion/pointer coarse e sem bloquear leitura estática, mobile ou acessibilidade. A imagem social específica ainda pode evoluir; o HTML servido usa atualmente o fallback `/og/default`.
2. **P2 — dados reais revisados / Fabuloso.** Curar resumos, transcrições e demais fontes existentes para produzir dados narrativos reais com **provenance, natureza da claim, revisão e visibility** antes de alimentar lore/grafo. Fato explícito, inferência e conflito permanecem distinguíveis; inferência não vira canon automaticamente. Owners: [Evidências](domains/evidence.md) e [Canon/review](domains/canon-review.md). Conteúdo privado não entra em issues, fixtures públicas ou payloads sem audience autorizada.
3. **P3 — edição autorizada do grafo / Espaguete.** Conectar somente projections revisadas/permitidas ao World Explorer e então habilitar edição compreensível com autorização server-side. Arrastar node continua sendo edição de layout; editar fato/relação é mutation narrativa distinta, com fonte/revisão/visibility, capability/scope, concorrência e recuperação de conflito. Owners: [World Explorer](features/world-explorer.md) e [Relations](features/relations-data-contract.md). React Flow é renderer, não schema nem fonte de verdade.

Com P1 publicada, **P2 passa a ser o próximo gate narrativo ativo** da sequência #99. P3 continua dependente de projections reais revisadas e autorizadas; publicação de Pipipi, por si só, não promove dados demonstrativos do grafo a canon.

Prancheta mantém estágio, PR/SHA, evidência e próximo gate no [inventário](delivery/inventory.md). A #99 coordena a rodada, mas não declara P2 ou P3 implementados, integrados ou publicados sem evidência própria.

### Frentes operacionais paralelas

As frentes abaixo continuam em paralelo e **não rebaixam P1/P2/P3 na ordem de produto**:

- **Parafuso — Edit:** convergência de persistence/revision/conflito/audit e UX real, preservando os gates donos de banco e autorização. Owners: [Edit](features/edit-workbench.md), [slice server-side](features/edit-transcript-server-slice.md) e [Identity/access](domains/identity-access.md).
- **Motorzinho/Painelzinho — operação local:** supervisor/serviço real, recuperação e painel sem confundir fundação sintética com ASR ou instalação persistente. Owners: [Companion](integrations/local-companion.md) e [Processing](domains/processing.md).
- **Carteiro/Cofrinho — sincronização:** bundle -> consumidor -> recibo durável/idempotente, sem sobrescrever conteúdo revisado e sem inferir aplicação de migration por merge. Owner: [Importação](integrations/transcript-import.md).
- **Balde — mídia:** upload, verificação pública e eventual promoção de referências continuam operações deliberadas e separadas. Owner: [R2](integrations/r2.md).
- **Catraca, Chaveiro e Contador de Feijão:** Auth, consulta de permissões e estatísticas mantêm seus próprios owners e evidências; mudanças de UX/estado não criam grants nem reabrem recortes concluídos sem defeito novo.

Toda superfície pública compartilhável deve resolver título, resumo e arte próprios quando houver conteúdo elegível pelo caminho runtime real. Teste de helper com fixture não prova integração.

## Marcos canônicos

### R1 — Fundação

**Estado:** concluída.

Repositório, CI sem auto-deploy, Supabase existente, Vercel controlada, R2 preparado, documentação modular e governança estão estabelecidos.

### R2 — Produto público

**Estado:** publicado e em evolução incremental.

Home/sessões, metadata social e a lore pioneira Pipipi possuem evidência de publicação. Evoluções de mídia e novas superfícies públicas continuam sujeitas aos mesmos critérios de metadata, audience, acessibilidade e release deliberado. A imagem social específica de Pipipi ainda usa fallback genérico no corte de 2026-09-11 e permanece melhoria separada.

### R3 — Auth e Edit

**Estado:** Auth possui evidência histórica de fluxo real; integração funcional do Edit continua em evolução.

Há evidência operacional anterior de OAuth real, conta autorizada, navegação e logout. Isso não implica que todo recorte posterior do Edit esteja publicado nem que migration integrada esteja aplicada. Persistence, smoke real e reconciliações de banco permanecem nos owners correspondentes.

### R4 — Operação local e sync

**Estado:** modernização em andamento por frentes coordenadas.

Processamento pesado e áudio bruto continuam locais. Cloud não vira requisito para transcrição bruta. Carteiro mantém o consumidor cloud de bundles/idempotência/recibo; integração de código e aplicação/ativação externa permanecem estados diferentes.

### R5 — Memória estruturada e perfis

**Estado:** schema/base parcialmente preparados; Pipipi pioneira publicada; conteúdo/projection reais em evolução.

`entities`, mentions, canon e profiles editoriais formam a base. Pipipi provou o caminho público de uma lore editorial dedicada com leitura estática, mídia e metadata próprias, sem criar entity/canon por conveniência. A generalização para projections reais continua dependente de dados revisados, provenance, visibility e contrato autorizado; a publicação de uma exceção editorial não antecipa esse fechamento.

### R6 — Relations e World Explorer

**Estado:** fundação visual existe; dados/relações reais e edição autorizada são os próximos marcos narrativos.

P2 entrega o conjunto revisado que pode alimentar projections autorizadas; P3 trata a edição do grafo. React Flow não define schema, fixture não vira canon e layout editorial permanece separado de fatos/relações narrativas.

### R7 — Knowledge/audience

**Estado:** em desenho.

Visibilidade técnica e conhecimento ficcional continuam dimensões distintas.

### R8 — Exploração avançada

**Estado:** planejado/incremental.

Timeline, busca, mapas, músicas, quests, estatísticas e demais superfícies avançam conforme contracts e fontes reais amadurecem; experimentação não antecipa conclusão canônica.

## Regras transversais

- conteúdo/evento/transcrição não vira canon automaticamente;
- fixture não vira dado canônico;
- IA sugere, humano revisa;
- audience/secrets são filtrados antes do browser;
- toda página pública com arte elegível deve emitir metadata individual pelo caminho default real;
- fallback social é somente fallback;
- estrutura visual externa ou experimental não substitui Design System, tokens, Brand Pack ou componentes TDA;
- parallax/motion são enhancement e nunca requisito para leitura;
- React Flow não define schema;
- mover node no grafo não altera relação, canon ou evidência;
- dado narrativo real exibido no grafo precisa de fonte/revisão/visibility compatíveis com sua audience;
- retries de sync precisam ser idempotentes e comprováveis por recibo/identidade, nunca por suposição;
- DDL exige migration versionada e aplicação separada;
- merge de migration não significa aplicação no Supabase;
- deploy é publicação controlada, nunca ferramenta de desenvolvimento;
- estabilização só conta como correção depois de patch aplicado e evidência correspondente; proposta isolada não altera estado;
- cloud deve permanecer nas franquias gratuitas/Hobby quando possível;
- processamento pesado e retenção de áudio bruto permanecem locais;
- documentação de coordenação aponta para owners, não copia suas specs.

O contrato dos conceitos está em [data-model.md](data-model.md), maturidade na `main` em [feature-catalog.md](feature-catalog.md), estados concretos no [inventário](delivery/inventory.md), publicação histórica em [deployments](operations/deployments.md) e taxonomia de entrega em [Documentação viva](documentation/README.md).
