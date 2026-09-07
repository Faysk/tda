# Roadmap

> Status: vigente
> Owner: produto / arquitetura
> Última revisão: 2026-09-07
> Fonte de verdade: `Faysk/tda@main`, `feature-catalog.md`, documentos donos e `operations/deployments.md`

Este roadmap coordena **ordem, dependências e estágio de entrega**. Ele não substitui as specs nem os runbooks donos de cada área. Detalhe técnico continua nos documentos linkados abaixo; aqui registramos apenas o que está em andamento, quais boundaries precisam convergir e o que ainda não pode ser declarado concluído.

Estágio de entrega segue [Documentação viva](documentation/README.md): branch/PR, validação, integração em `main` e publicação/aplicação são estados diferentes. `main = Production` é a linha de código aceita, mas não existe auto-deploy.

## Baseline vigente — Production #003

A referência operacional atual é **Production #003**, source SHA `0120e38d28c51f3e90aa7336dfa8e7910df074f4`, registrada em [Histórico de deployments](operations/deployments.md). A `main` contém também documentação posterior desse release; isso não muda retroativamente o source publicado.

Estado comprovado do baseline:

- Home e sessões públicas operacionais em `https://dnd.faysk.dev`;
- metadata individual das 11 sessões corrigida no caminho padrão real de produção;
- cada sessão emite título, resumo e artwork `verified-public` própria quando elegível;
- regressão cobre o **registry runtime real**, sem depender somente de manifesto injetado em teste;
- fallback social é permitido somente quando não existe arte pública elegível;
- 22 imagens públicas do conjunto de sessão tiveram entrega/hash verificados no R2;
- nenhuma promoção CAS das referências de sessão para R2 foi executada nesse release;
- nenhuma nova migration foi aplicada por causa do release #003.

Invariante para qualquer superfície pública nova ou existente: **sessão, personagem, NPC, item, lore e demais páginas compartilháveis devem resolver título, resumo e arte próprios quando houver conteúdo elegível**. Teste de helper com fixture não prova integração; o caminho default usado em produção precisa ser exercitado.

## Rodada paralela autorizada

A rodada seguinte pode avançar em paralelo. Paralelismo não elimina integração coordenada: cada frente preserva seu boundary, atualiza o documento dono quando o contrato mudar e só converge para `main` depois de validação no head exato. Deployments, migrations, CAS e configuração remota continuam deliberados e independentes de merge.

| Codinome | Frente | Estado desta rodada | Documento(s) dono(s) | Gate de integração |
| --- | --- | --- | --- | --- |
| **Pipoca** | lore real **Pipipi** | **em andamento** | [Perfis editoriais](features/entity-profiles.md), [Entities](domains/entities.md), [Canon/review](domains/canon-review.md) | usar conteúdo/projection realmente autorizados; não promover fixture; metadata própria no caminho default |
| **Claquete** | camada cinematográfica opcional | **em andamento** | [Perfis editoriais](features/entity-profiles.md), [Superfícies públicas](design-system/public-surfaces.md) | enhancement opcional; leitura estática, acessibilidade e `prefers-reduced-motion` continuam válidos sem cinematic |
| **Espaguete** | grafo React Flow | **em andamento** | [World Explorer](features/world-explorer.md), [Relações/grafo](features/relations-graph.md), [contrato de relations](features/relations-data-contract.md), [ADR-0006](adr/0006-react-flow-world-explorer.md) | React Flow continua renderer, não schema; fixture não vira relation canônica; projection deve respeitar audience |
| **Parafuso** | integração do Edit | **em andamento** | [Edit Workbench](features/edit-workbench.md), [slice server-side](features/edit-transcript-server-slice.md), [arquitetura Edit](architecture/edit-workbench.md), [Identity/access](domains/identity-access.md) | convergir Auth/capability + adapter + optimistic concurrency/audit + UX real; migration integrada não equivale a migration aplicada |
| **Catraca** | configuração Discord | **em andamento** | [Identity/access](domains/identity-access.md), [runbook Discord Auth](operations/discord-auth.md), [Ambientes](operations/environments.md) | validar configuração/callback/OAuth real sem colocar secrets no Git; configuração remota precisa de evidência própria |
| **Contador** | estatísticas | **em andamento** | [Catálogo de features](feature-catalog.md) e [domínio Sessions](domains/sessions.md) enquanto o contrato é fechado | começar por leitura/derivação dos dados existentes; não inferir schema, writes ou métricas canônicas antes da implementação concreta exigir isso |
| **Balde** | mídia R2 | **em andamento** | [Cloudflare R2](integrations/r2.md), [entrega pública de mídia](integrations/media-public-delivery-2026-09-07.md), [deployments](operations/deployments.md) | preservar 22/22 verified-public; metadata runtime já usa arte verificada, mas referências do site só mudam por CAS controlado após gates e snapshot atual |

Os codinomes são **coordenação de execução**, não novos conceitos de domínio. Specs continuam com seus nomes canônicos. O registry local `D:/Projects/tda/.local/coordination-chats.json` acompanha a distribuição das frentes e permanece local/não versionado; a documentação versionada continua sendo a fonte para contratos, estado integrado e operação comprovada.

### Regra de prioridade desta rodada

A antiga leitura estritamente serial “público → Edit → novas features” serviu à consolidação inicial. Com a Production #003 estável, estas sete frentes estão autorizadas a progredir **em paralelo**, desde que:

1. não alterem silenciosamente o boundary de outra frente;
2. conflitos em arquivos donos sejam reconciliados explicitamente antes da integração;
3. nenhuma branch anuncie conclusão pela existência de código ou CI isolado;
4. PR só seja aberta/validada quando houver mudança concreta suficiente para revisão;
5. CI terminal seja observado no SHA exato que se pretende integrar;
6. merge não execute automaticamente deploy, migration, CAS, DNS ou configuração de provider;
7. publicação use o runbook e registre o source SHA realmente publicado.

## Dependências de convergência

### Lore / cinematic / grafo

Pipoca, Claquete e Espaguete podem evoluir ao mesmo tempo porque compartilham contracts, não ownership de implementação:

- `entity-profiles.md` continua dono de conteúdo/perfil/presentation engine;
- cinematic é enhancement da mesma lore, não uma segunda fonte de texto/canon;
- `world-explorer.md` continua dono da experiência do grafo;
- relations e audience continuam nos documentos de domínio/schema correspondentes;
- metadata pública reutiliza o helper/contrato compartilhado e deve provar o resultado default real, sem builder paralelo.

### Edit / Discord

Parafuso e Catraca são paralelos, mas convergem no boundary de identidade:

- Catraca prova que Auth Discord está realmente configurado no ambiente e que callback/login funcionam;
- Parafuso consome identidade verificada + capabilities; não cria autorização paralela;
- mutation/audit do Edit só é declarada operacional depois da aplicação de banco correspondente e do fluxo end-to-end validado;
- retirada do bypass temporário é etapa posterior à convergência, não pré-condição para desenvolver a integração.

### R2 / metadata

Balde não precisa recriar a correção de metadata:

- Production #003 já promoveu o registry runtime de sessão e provou 11 imagens distintas no crawler;
- `media.dnd.faysk.dev` permanece a entrega pública verificada;
- a frente atual cuida do ciclo de mídia/referências e eventual CAS, não de um novo metadata builder;
- qualquer nova arte de entity/lore entra em metadata somente após cumprir o mesmo padrão `verified-public` e ser ligada ao caminho default da página.

### Estatísticas

Contador começa sem impor modelo novo. O primeiro recorte deve identificar quais estatísticas são deriváveis das fontes já canônicas e publicáveis. Se surgir semântica própria, persistence ou autorização específica, aí sim nasce/expande um documento dono dedicado antes de DDL. Até lá, roadmap e catálogo registram a frente sem duplicar uma spec inexistente.

## Marcos canônicos

### R1 — Fundação

**Estado:** concluída.

Repositório, CI sem auto-deploy, Supabase existente, Vercel controlada, R2 preparado, documentação modular e governança estão estabelecidos.

### R2 — Produto público

**Estado:** publicado e em evolução incremental.

Home/sessões e metadata social estão em production. A correção de identidade visual dos links pertence à Production #003. Evoluções de mídia e novas superfícies públicas continuam sujeitas aos mesmos critérios de metadata, audience, acessibilidade e release deliberado.

### R3 — Auth e Edit

**Estado:** implementação integrada parcialmente; convergência operacional em andamento.

Runtime de Auth/guards e componentes do Edit já existem na `main`; configuração OAuth real, aplicação do boundary de persistence quando autorizada e integração end-to-end continuam tarefas distintas. Owners: [Identity/access](domains/identity-access.md), [Discord Auth](operations/discord-auth.md) e [Edit](features/edit-workbench.md).

### R4 — Operação local

**Estado:** planejado/evolução incremental.

Processamento pesado e áudio bruto continuam locais. Cloud não vira requisito para transcrição bruta.

### R5 — Memória estruturada e perfis

**Estado:** schema/base parcialmente preparados; conteúdo/projection reais em evolução.

`entities`, mentions, canon e profiles editoriais formam a base. Pipoca é o recorte ativo de lore real desta rodada.

### R6 — Relations e World Explorer

**Estado:** slice visual integrado; dados/relações canônicas em evolução.

Espaguete é o recorte ativo. React Flow não define schema e não autoriza publicação de fixtures como canon.

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
- DDL exige migration versionada e aplicação separada;
- merge de migration não significa aplicação no Supabase;
- deploy é publicação controlada, nunca ferramenta de desenvolvimento;
- cloud deve permanecer nas franquias gratuitas/Hobby quando possível;
- processamento pesado e retenção de áudio bruto permanecem locais;
- documentação de coordenação aponta para owners, não copia suas specs.

O contrato dos conceitos está em [data-model.md](data-model.md), maturidade na `main` em [feature-catalog.md](feature-catalog.md), operação publicada em [deployments](operations/deployments.md) e taxonomia de entrega em [Documentação viva](documentation/README.md).
