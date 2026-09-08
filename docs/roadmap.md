# Roadmap

> Status: vigente
> Owner: produto / arquitetura
> Última revisão: 2026-09-08
> Fonte de verdade: `Faysk/tda@main`, `feature-catalog.md`, documentos donos e `operations/deployments.md`

Este roadmap coordena **ordem, dependências e estágio de entrega**. Ele não substitui as specs nem os runbooks donos de cada área. Detalhe técnico continua nos documentos linkados abaixo; aqui registramos apenas o que está em andamento, quais boundaries precisam convergir e o que ainda não pode ser declarado concluído.

Estágio de entrega segue [Documentação viva](documentation/README.md): branch/PR, validação, integração em `main` e publicação/aplicação são estados diferentes. `main = Production` é a linha de código aceita, mas não existe auto-deploy.

## Base atual e prioridade de entrega

Production #006 publicou o source `7dd4b06d1a246ad924230530c2a0424e830aa46d`: home/sessões, metadata individual, login Discord, estatísticas autorizadas, consulta de permissões e painel local. OAuth real, acesso, navegação e logout foram verificados. O painel informa serviço desconectado; isso não comprova ASR ou sincronização real. Evidências em [deployments](operations/deployments.md).

A importação foi integrada pela [PR #61](https://github.com/Faysk/tda/pull/61), em `81219c009eeb87593df2458c836d40fcfa2a2491`, mas permanece desativada. Migrations e grants não foram aplicados. O [inventário de entregas](delivery/inventory.md) é o quadro operacional único; este roadmap define ordem e dependências.

1. **Parafuso — Edit:** concluir identidade/capability + adapter canônico + revision/conflito/audit e UX real. Aplicação de RPC e ensaio ponta a ponta continuam gates separados. Owners: [Edit](features/edit-workbench.md), [slice server-side](features/edit-transcript-server-slice.md), [Identity/access](domains/identity-access.md).
2. **Motorzinho/Painelzinho — operação local:** ligar supervisor durável ao motor existente, validar painel e recuperação com serviço real. Fundação sintética não comprova ASR ou instalação persistente. Owners: [Companion](integrations/local-companion.md), [Processing](domains/processing.md).
3. **Carteiro/Cofrinho — sincronização:** concluir resultado local -> consumidor -> recibo confirmado. Bloquear também no controller quando `sync=false`; preservar cancelamento e vínculo ao job. Destino deve ser uma sessão apropriada, sem sobrescrever transcrições existentes. Gates em [Importação](integrations/transcript-import.md).
4. **Rodada narrativa #99 — Pipoca/Cuscuz/Espaguete:** usar Pipipi como lore pioneira completa, curar dados reais com provenance/revisão/visibility e então alimentar o World Explorer somente com projections autorizadas. Edição de layout e edição de fatos/relações permanecem operações distintas; a segunda depende de fonte, review, capability server-side e concorrência. O [inventário](delivery/inventory.md) registra estágio/evidência; contratos permanecem em [Perfis](features/entity-profiles.md), [Canon/review](domains/canon-review.md), [World Explorer](features/world-explorer.md) e [Relations](features/relations-data-contract.md). A issue [#99](https://github.com/Faysk/tda/issues/99) coordena a rodada, mas não declara implementação, integração ou publicação.
5. **Balde — mídia:** preparação #54 integrada; próximos gates são upload deliberado, entrega pública verificada e eventual promoção de referências, como etapas distintas. Owner: [R2](integrations/r2.md).

Catraca acompanha regressões de login e o nome legado do app Discord. Contador de Feijão mantém [estatísticas](features/transcript-statistics.md), explicitando duração ausente. Chaveiro mantém a consulta somente leitura de permissões. Prancheta mantém o inventário e Lupa a revisão independente. Não abrir novas frentes antes de fechar estas entregas.

Toda superfície pública compartilhável deve resolver título, resumo e arte próprios quando houver conteúdo elegível pelo caminho runtime real. Teste de helper com fixture não prova integração.

## Marcos canônicos

### R1 — Fundação

**Estado:** concluída.

Repositório, CI sem auto-deploy, Supabase existente, Vercel controlada, R2 preparado, documentação modular e governança estão estabelecidos.

### R2 — Produto público

**Estado:** publicado e em evolução incremental.

Home/sessões e metadata social estão em production. A correção de identidade visual dos links nasceu na Production #003 e permanece na linha publicada pela Production #006. Evoluções de mídia e novas superfícies públicas continuam sujeitas aos mesmos critérios de metadata, audience, acessibilidade e release deliberado.

### R3 — Auth e Edit

**Estado:** login publicado e verificado; integração funcional do Edit em andamento.

Production #006 comprovou OAuth real, conta autorizada, navegação e logout. Persistence canônica, aplicação deliberada de RPC e validação ponta a ponta do Edit continuam pendentes. Owners: [Identity/access](domains/identity-access.md), [Discord Auth](operations/discord-auth.md), [Edit](features/edit-workbench.md).

### R4 — Operação local e sync

**Estado:** modernização em andamento por frentes coordenadas.

Processamento pesado e áudio bruto continuam locais. Cloud não vira requisito para transcrição bruta. Carteiro é o recorte ativo do consumidor cloud de bundles/idempotência/recibo, com fundação integrada e endpoints ainda negados; ativação segue o contrato de importação.

### R5 — Memória estruturada e perfis

**Estado:** schema/base parcialmente preparados; conteúdo/projection reais em evolução.

`entities`, mentions, canon e profiles editoriais formam a base. A rodada #99 escolhe Pipipi como lore pioneira para provar o caminho completo com conteúdo aprovado, leitura estática, mídia e metadata próprias. Isso não generaliza uma nova rota para todas as entities nem antecipa publicação.

### R6 — Relations e World Explorer

**Estado:** slice visual integrado; dados/relações canônicas em evolução.

Espaguete é o recorte ativo. React Flow não define schema e não autoriza publicação de fixtures como canon. A rodada #99 prioriza substituir demonstrações por dados reais revisados e preparar edição autorizada, mantendo layout editorial separado de fatos/relações narrativas.

### R7 — Knowledge/audience

**Estado:** em desenho.

Visibilidade técnica e conhecimento ficcional continuam dimensões distintas.

### R8 — Exploração avançada

**Estado:** planejado/incremental.

Timeline, busca, mapas, músicas, quests, estatísticas e demais superfícies avançam conforme contracts e fontes reais amadurecem; a rodada paralela pode antecipar experimentação sem antecipar conclusão canônica.

## Regras transversais

- conteúdo/evento/transcrição não vira canon automaticamente;
- fixture não vira dado canônico;
- IA sugere, humano revisa;
- audience/secrets são filtrados antes do browser;
- toda página pública com arte elegível deve emitir metadata individual pelo caminho default real;
- fallback social é somente fallback;
- React Flow não define schema;
- mover node no grafo não altera relação, canon ou evidência;
- dado narrativo real exibido no grafo precisa de fonte/revisão/visibility compatíveis com sua audience;
- retries de sync precisam ser idempotentes e comprováveis por recibo/identidade, nunca por suposição;
- DDL exige migration versionada e aplicação separada;
- merge de migration não significa aplicação no Supabase;
- deploy é publicação controlada, nunca ferramenta de desenvolvimento;
- cloud deve permanecer nas franquias gratuitas/Hobby quando possível;
- processamento pesado e retenção de áudio bruto permanecem locais;
- documentação de coordenação aponta para owners, não copia suas specs.

O contrato dos conceitos está em [data-model.md](data-model.md), maturidade na `main` em [feature-catalog.md](feature-catalog.md), operação publicada em [deployments](operations/deployments.md) e taxonomia de entrega em [Documentação viva](documentation/README.md).
