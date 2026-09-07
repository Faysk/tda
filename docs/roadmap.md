# Roadmap

> Status: vigente
> Owner: produto / arquitetura
> Última revisão: 2026-09-07
> Fonte de verdade: `Faysk/tda@main`, `feature-catalog.md`, documentos donos e `operations/deployments.md`

Este roadmap coordena **ordem, dependências e estágio de entrega**. Ele não substitui as specs nem os runbooks donos de cada área. Detalhe técnico continua nos documentos linkados abaixo; aqui registramos apenas o que está em andamento, quais boundaries precisam convergir e o que ainda não pode ser declarado concluído.

Estágio de entrega segue [Documentação viva](documentation/README.md): branch/PR, validação, integração em `main` e publicação/aplicação são estados diferentes. `main = Production` é a linha de código aceita, mas não existe auto-deploy.

## Baseline vigente — Production #004

A referência operacional atual é **Production #004**, deployment `dpl_7YhRViksD5bxgYMvSTTWiTg4qXdD`, READY em `2026-09-07T19:21:22.439Z`, registrada em [Histórico de deployments](operations/deployments.md). O source publicado continua sendo `0120e38d28c51f3e90aa7336dfa8e7910df074f4`: este release republicou o mesmo código com configuração de Auth de production corrigida, sem transformar commits documentais posteriores da `main` em source do deployment.

Estado comprovado do baseline:

- Home e sessões públicas operacionais em `https://dnd.faysk.dev`;
- a correção de metadata individual da Production #003 permanece vigente: 11 sessões emitem título, resumo e artwork próprios quando elegíveis pelo caminho runtime real;
- 22 imagens públicas do conjunto de sessão seguem verificadas no R2; nenhuma promoção CAS das referências de sessão para R2 foi executada;
- Vercel production recebeu `SUPABASE_PUBLISHABLE_KEY` e `TDA_AUTH_ORIGIN=https://dnd.faysk.dev` somente no target Production após confirmação de ausência da configuração necessária;
- não houve rotação de credenciais, grant, configuração de Preview, migration ou escrita de banco nessa operação;
- `/entrar` responde com **Entrar com Discord** habilitado;
- `/api/auth/me` responde `200` para visitante anônimo com `state=anonymous` e `capabilities=[]`;
- smoke do início do OAuth registrou `POST /auth/discord` -> `303` para Supabase -> `302` para `discord.com`;
- **OAuth real com consentimento, retorno ao callback, vínculo de profile e capabilities reais continua pendente**. Production #004 prova configuração e início do fluxo, não login completo.

Invariante para qualquer superfície pública nova ou existente: **sessão, personagem, NPC, item, lore e demais páginas compartilháveis devem resolver título, resumo e arte próprios quando houver conteúdo elegível**. Teste de helper com fixture não prova integração; o caminho default usado em produção precisa ser exercitado.

## Rodada paralela autorizada

A rodada seguinte pode avançar em paralelo. Paralelismo não elimina integração coordenada: cada frente preserva seu boundary, atualiza o documento dono quando o contrato mudar e só converge para `main` depois de validação no head exato. Deployments, migrations, CAS e configuração remota continuam deliberados e independentes de merge.

| Codinome | Frente | Estado desta rodada | Documento(s) dono(s) | Gate de integração |
| --- | --- | --- | --- | --- |
| **Pipoca** | lore real **Pipipi** | **em andamento** | [Perfis editoriais](features/entity-profiles.md), [Entities](domains/entities.md), [Canon/review](domains/canon-review.md) | usar conteúdo/projection realmente autorizados; não promover fixture; metadata própria no caminho default |
| **Claquete** | camada cinematográfica opcional | **em andamento** | [Perfis editoriais](features/entity-profiles.md), [Superfícies públicas](design-system/public-surfaces.md) | enhancement opcional; leitura estática, acessibilidade e `prefers-reduced-motion` continuam válidos sem cinematic |
| **Espaguete** | grafo React Flow | **em andamento** | [World Explorer](features/world-explorer.md), [Relações/grafo](features/relations-graph.md), [contrato de relations](features/relations-data-contract.md), [ADR-0006](adr/0006-react-flow-world-explorer.md) | React Flow continua renderer, não schema; fixture não vira relation canônica; projection deve respeitar audience |
| **Parafuso** | integração do Edit | **em andamento** | [Edit Workbench](features/edit-workbench.md), [slice server-side](features/edit-transcript-server-slice.md), [arquitetura Edit](architecture/edit-workbench.md), [Identity/access](domains/identity-access.md) | convergir Auth/capability + adapter + optimistic concurrency/audit + UX real; migration integrada não equivale a migration aplicada |
| **Catraca** | configuração Discord | **em andamento; Production #004 configurada** | [Identity/access](domains/identity-access.md), [runbook Discord Auth](operations/discord-auth.md), [Ambientes](operations/environments.md), [deployments](operations/deployments.md) | configuração production e início do redirect estão provados; concluir somente após OAuth real/consentimento/callback e teste de conta/capabilities |
| **Contador** | estatísticas de transcrição | **em andamento; PR #56 CI green, aguardando revisão** | owner candidato `docs/features/transcript-statistics.md` na [PR #56](https://github.com/Faysk/tda/pull/56); enquanto não integrada, [Sessions](domains/sessions.md) e [feature catalog](feature-catalog.md) continuam owners canônicos na `main` | head `88ae8534dcdb3966e694665653ed7d4156fb6d66` com CI terminal success; revisão/integração ainda pendentes; não declarar publicado |
| **Balde** | mídia R2 | **em andamento** | [Cloudflare R2](integrations/r2.md), [entrega pública de mídia](integrations/media-public-delivery-2026-09-07.md), [deployments](operations/deployments.md) | preservar 22/22 verified-public; metadata runtime já usa arte verificada, mas referências do site só mudam por CAS controlado após gates e snapshot atual |
| **Carteiro** | consumidor cloud de bundle/sync | **em andamento** | [Companion local](integrations/local-companion.md), [Processing](domains/processing.md), [fluxos ponta a ponta](architecture/data-flows.md) | Carteiro é dono do lado consumidor cloud de **bundle + idempotência + recibo**; contrato coordena com Motorzinho/Painelzinho/Cofrinho sem inventar endpoint/schema antes das respectivas frentes; retry não pode duplicar efeitos remotos |

Os codinomes são **coordenação de execução**, não novos conceitos de domínio. Specs continuam com seus nomes canônicos. O registry local `D:/Projects/tda/.local/coordination-chats.json` acompanha a distribuição das frentes e permanece local/não versionado; a documentação versionada continua sendo a fonte para contratos, estado integrado e operação comprovada.

A frente Carteiro está associada no registry local ao identificador `01a07d51-8789-7e83-bfa1-962719442447`. Esse identificador coordena a execução e não vira identidade de domínio, endpoint ou chave persistida do produto.

### Regra de prioridade desta rodada

A antiga leitura estritamente serial “público → Edit → novas features” serviu à consolidação inicial. Com a Production #004 operacional, estas oito frentes estão autorizadas a progredir **em paralelo**, desde que:

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

- Production #004 removeu a pendência de configuração mínima do app em production e provou que o início do fluxo chega ao Discord;
- isso não prova consentimento, callback, sessão autenticada, profile resolvido ou capabilities reais;
- Parafuso consome identidade verificada + capabilities; não cria autorização paralela;
- mutation/audit do Edit só é declarada operacional depois da aplicação de banco correspondente e do fluxo end-to-end validado;
- retirada do bypass temporário é etapa posterior à convergência, não pré-condição para desenvolver a integração.

### R2 / metadata

Balde não precisa recriar a correção de metadata:

- Production #003 promoveu o registry runtime de sessão e provou 11 imagens distintas no crawler; Production #004 republicou o mesmo source e preserva esse comportamento;
- `media.dnd.faysk.dev` permanece a entrega pública verificada;
- a frente atual cuida do ciclo de mídia/referências e eventual CAS, não de um novo metadata builder;
- qualquer nova arte de entity/lore entra em metadata somente após cumprir o mesmo padrão `verified-public` e ser ligada ao caminho default da página.

### Estatísticas

Contador agora possui candidato concreto na PR #56. O head `88ae8534dcdb3966e694665653ed7d4156fb6d66` passou CI, mas a PR continua aberta e aguardando revisão. Seu documento candidato `docs/features/transcript-statistics.md` é dono da implementação proposta; até integração, o estado canônico da `main` permanece nos owners atuais e este roadmap não copia sua spec.

### Bundle/sync cloud

Carteiro assume o boundary **consumidor cloud** da sincronização sem absorver as responsabilidades do companion local:

- Motorzinho/Painelzinho/Cofrinho podem produzir, preparar ou acompanhar partes do fluxo conforme seus próprios contratos de coordenação;
- Carteiro recebe/valida bundle no lado cloud, aplica idempotência e devolve recibo suficiente para retry seguro;
- o contrato existente de [Companion local](integrations/local-companion.md) e [Processing](domains/processing.md) continua dono dos invariantes de source identity, protocol version, checksum, fila/retry e não duplicação;
- nenhuma tabela, RPC, endpoint, formato final de bundle ou mecanismo de autenticação é inferido por este índice antes de existir implementação/owner concreto que o defina.

## Marcos canônicos

### R1 — Fundação

**Estado:** concluída.

Repositório, CI sem auto-deploy, Supabase existente, Vercel controlada, R2 preparado, documentação modular e governança estão estabelecidos.

### R2 — Produto público

**Estado:** publicado e em evolução incremental.

Home/sessões e metadata social estão em production. A correção de identidade visual dos links nasceu na Production #003 e permanece no source republicado pela Production #004. Evoluções de mídia e novas superfícies públicas continuam sujeitas aos mesmos critérios de metadata, audience, acessibilidade e release deliberado.

### R3 — Auth e Edit

**Estado:** runtime integrado; configuração mínima de Auth publicada; convergência funcional em andamento.

Production #004 comprova configuração production e início do redirect OAuth. **Não comprova login completo.** OAuth real/consentimento/callback, profile/capabilities reais, aplicação do boundary de persistence quando autorizada e integração end-to-end do Edit continuam etapas distintas. Owners: [Identity/access](domains/identity-access.md), [Discord Auth](operations/discord-auth.md) e [Edit](features/edit-workbench.md).

### R4 — Operação local e sync

**Estado:** modernização em andamento por frentes coordenadas.

Processamento pesado e áudio bruto continuam locais. Cloud não vira requisito para transcrição bruta. Carteiro é o recorte ativo do consumidor cloud de bundles/idempotência/recibo, preservando o contrato do companion e sem antecipar endpoint/schema.

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
- retries de sync precisam ser idempotentes e comprováveis por recibo/identidade, nunca por suposição;
- DDL exige migration versionada e aplicação separada;
- merge de migration não significa aplicação no Supabase;
- deploy é publicação controlada, nunca ferramenta de desenvolvimento;
- cloud deve permanecer nas franquias gratuitas/Hobby quando possível;
- processamento pesado e retenção de áudio bruto permanecem locais;
- documentação de coordenação aponta para owners, não copia suas specs.

O contrato dos conceitos está em [data-model.md](data-model.md), maturidade na `main` em [feature-catalog.md](feature-catalog.md), operação publicada em [deployments](operations/deployments.md) e taxonomia de entrega em [Documentação viva](documentation/README.md).
