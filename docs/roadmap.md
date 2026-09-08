# Roadmap

> Status: vigente
> Owner: produto / arquitetura
> Última revisão: 2026-09-08
> Fonte de verdade: `Faysk/tda@main`, `feature-catalog.md`, documentos donos, `delivery/inventory.md` e `operations/deployments.md`

Este roadmap coordena **ordem, dependências e prioridade de produto**. Ele não substitui as specs nem os runbooks donos de cada área. O [inventário de entregas](delivery/inventory.md) é o registro operacional único de estágio/evidência; aqui ficam somente prioridade, direção e dependências entre frentes.

Estágio de entrega segue [Documentação viva](documentation/README.md): branch/PR, validação, integração em `main` e publicação/aplicação são estados diferentes. `main = Production` descreve a linha de código aceita, mas não existe auto-deploy e merge não comprova aplicação externa.

## Base observável e prioridade atual

A `main` consultada nesta revisão está em `80eab3a8c267e3e3900cd7c9399f23bf914d994d`. O histórico em [deployments](operations/deployments.md) preserva evidências de publicações anteriores, inclusive Production #006, mas **não é usado aqui para deduzir o SHA atualmente servido**: a observação mais recente de health informou `commit=null`. Sem um recibo runtime que associe a resposta a um source, o roadmap não declara qual commit está ativo em produção.

A importação permanece integrada no repositório mas sua ativação/aplicação externa continua um gate separado. Da mesma forma, migration integrada não é tratada como migration aplicada. Estados concretos e evidências ficam no [inventário](delivery/inventory.md) e nos documentos operacionais donos.

### Estabilização antes da publicação — #102

A rodada [#102](https://github.com/Faysk/tda/issues/102) é um gate de **estabilização**, não uma nova frente de produto: corrige defeitos reproduzíveis, regressões visuais/acessibilidade e acabamento sobre os contratos existentes. Ela não altera a ordem P1/P2/P3 abaixo, não promove feature incompleta e não transforma proposta em correção aplicada. Prancheta mantém estágio/evidência no [inventário](delivery/inventory.md); Foguete consolida os gates do candidato; Marreta/Lupa fazem validação independente. Publicação continua deliberada e só pode ser declarada por evidência do SHA candidato e da operação correspondente.

### Prioridade de produto — rodada #99

1. **P1 — Pipipi oficial / Pipoca.** Pipipi é a lore pioneira e a prioridade de publicação da rodada [#99](https://github.com/Faysk/tda/issues/99). A implementação deve reutilizar [Perfis editoriais](features/entity-profiles.md), [Design System](design-system/README.md), [superfícies públicas](design-system/public-surfaces.md), metadata pública central e mídia elegível. Estrutura visual/cinematic existente é **referência**, não um novo contrato visual: tokens, Brand Pack e componentes vigentes continuam canônicos. Parallax deve ser adaptado como progressive enhancement, respeitar reduced motion/pointer coarse e **nunca bloquear a leitura estática**, mobile, acessibilidade ou publicação quando o conteúdo/mídia elegíveis estiverem prontos. Cinematic opcional não bloqueia P1.
2. **P2 — dados reais revisados / Fabuloso.** Curar resumos, transcrições e demais fontes existentes para produzir dados narrativos reais com **provenance, natureza da claim, revisão e visibility** antes de alimentar lore/grafo. Fato explícito, inferência e conflito permanecem distinguíveis; inferência não vira canon automaticamente. Owners: [Evidências](domains/evidence.md) e [Canon/review](domains/canon-review.md). Conteúdo privado não entra em issues, fixtures públicas ou payloads sem audience autorizada.
3. **P3 — edição autorizada do grafo / Espaguete.** Conectar somente projections revisadas/permitidas ao World Explorer e então habilitar edição compreensível com autorização server-side. Arrastar node continua sendo edição de layout; editar fato/relação é mutation narrativa distinta, com fonte/revisão/visibility, capability/scope, concorrência e recuperação de conflito. Owners: [World Explorer](features/world-explorer.md) e [Relations](features/relations-data-contract.md). React Flow é renderer, não schema nem fonte de verdade.

Prancheta mantém estágio, PR/SHA, evidência e próximo gate no [inventário](delivery/inventory.md). A #99 coordena a rodada, mas não declara P1, P2 ou P3 implementados, integrados ou publicados sem evidência própria.

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

Home/sessões e metadata social possuem evidência histórica de publicação. A correção de metadata individual também possui registro operacional, mas o roadmap não usa um deployment histórico para inferir o SHA ativo quando o health observado não informa commit. Evoluções de mídia e novas superfícies públicas continuam sujeitas aos mesmos critérios de metadata, audience, acessibilidade e release deliberado.

### R3 — Auth e Edit

**Estado:** Auth possui evidência histórica de fluxo real; integração funcional do Edit continua em evolução.

Há evidência operacional anterior de OAuth real, conta autorizada, navegação e logout. Isso não implica que todo recorte posterior do Edit esteja publicado nem que migration integrada esteja aplicada. Persistence, smoke real e reconciliações de banco permanecem nos owners correspondentes.

### R4 — Operação local e sync

**Estado:** modernização em andamento por frentes coordenadas.

Processamento pesado e áudio bruto continuam locais. Cloud não vira requisito para transcrição bruta. Carteiro mantém o consumidor cloud de bundles/idempotência/recibo; integração de código e aplicação/ativação externa permanecem estados diferentes.

### R5 — Memória estruturada e perfis

**Estado:** schema/base parcialmente preparados; conteúdo/projection reais em evolução.

`entities`, mentions, canon e profiles editoriais formam a base. A rodada #99 torna Pipipi o **P1 de publicação** para provar o caminho completo com conteúdo aprovado, leitura estática, mídia e metadata próprias. Isso não generaliza uma nova rota para todas as entities nem antecipa publicação.

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
