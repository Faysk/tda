# Infraestrutura e estado

> Status: vigente; production ativa
> Owner: infraestrutura/operação
> Última revisão: 2026-09-07
> Fonte de verdade: documentos donos de Vercel/R2/Supabase e `operations/deployments.md`

Este documento resume o **estado operacional comprovado**. Código integrado, branch em andamento ou CI verde não altera sozinho este inventário: mudança externa só entra aqui depois de publicação/aplicação com evidência no documento dono.

## Snapshot operacional vigente

| Recurso | Estado comprovado |
| --- | --- |
| GitHub `Faysk/tda` | repositório canônico; `main` é linha aceita; push não dispara deployment |
| Vercel `tda` | Hobby, Node 24; production ativa; publicação manual/controlada |
| Production vigente | **Production #004**, source SHA `0120e38d28c51f3e90aa7336dfa8e7910df074f4`, deployment `dpl_7YhRViksD5bxgYMvSTTWiTg4qXdD` |
| Site/domínio | `https://dnd.faysk.dev` ativo sobre o projeto `tda` |
| Metadata pública | 11 sessões verificadas com título/resumo/artwork próprios no crawler; registry runtime real promovido desde Production #003 e preservado no mesmo source da #004 |
| R2 `tda-media-public` | 22 imagens de sessão publicadas e verificadas em `https://media.dnd.faysk.dev`; `r2.dev` desativado |
| R2 `tda-media-private` | privado |
| R2 `tda-media-preview` | privado e isolado de production |
| Referências de sessão no banco | continuam nas origens funcionais atuais; promoção CAS para R2 **não executada** |
| Supabase `dmrqnbdvbkfqzctcerbx` | base única existente; nenhuma migration/grant/escrita de DB fez parte da Production #004 |
| Discord Auth | runtime/guards integrados; configuração mínima do app publicada em Production; OAuth real/consentimento/callback/permissões ainda pendentes |
| Vercel legado `DND/dnd-scribe` | retirado; não é rollback do reboot |

O histórico detalhado e append-only de cada release está em [deployments](operations/deployments.md). Production #004 é a referência publicada, mesmo que a `main` receba commits posteriores de documentação ou candidatos: **source publicado e head do Git são identidades distintas**.

## Production #004 — configuração Auth

A Production #004 republicou o mesmo source `0120e38d28c51f3e90aa7336dfa8e7910df074f4` da Production #003 com a configuração mínima de Auth corrigida no target Production.

Evidência operacional registrada:

- deployment `dpl_7YhRViksD5bxgYMvSTTWiTg4qXdD`;
- target `production`;
- READY em `2026-09-07T19:21:22.439Z`;
- aliases incluem `dnd.faysk.dev`, `tda-three.vercel.app` e `tda-projeto-desenv-6905s-projects.vercel.app`;
- Dashboard Vercel confirmou a ausência prévia da configuração necessária e a posterior adição **Production-only** de `SUPABASE_PUBLISHABLE_KEY` e `TDA_AUTH_ORIGIN=https://dnd.faysk.dev`;
- nenhuma rotação de credencial, grant, alteração de Preview, migration, escrita de dados ou DNS foi executada;
- `/entrar` respondeu `200` com **Entrar com Discord** habilitado;
- `/api/auth/me` respondeu `200` com `state=anonymous`, scope da campanha e `capabilities=[]` para visitante anônimo;
- smoke do início do OAuth registrou `POST /auth/discord` -> `303` para Supabase -> `302` para `discord.com`.

Essas evidências comprovam **configuração do app e início do fluxo**. Não comprovam OAuth completo. Consentimento real no Discord, retorno ao callback do TDA, troca de código, sessão autenticada, vínculo com `profiles` e capabilities reais continuam pendentes. Catraca permanece **em andamento**.

O recibo operacional local informado para esta publicação é `D:/Projects/tda/.local/production004-auth.md`. Ele permanece local/não versionado; este repositório registra apenas o estado e a evidência necessária sem copiar secrets.

Rollback operacional da Production #004: **Production #003**, deployment `dpl_GHJgH7VdNrJd9izpYScog48UjSsE`, preservando o mesmo source de aplicação e retirando o release de configuração atual se necessário.

## Production #003 — metadata individual

A Production #003 corrigiu a regressão de metadata individual sem promover referências de banco para R2. Esse comportamento continua vigente porque Production #004 reutiliza o mesmo source.

Evidência registrada:

- source SHA `0120e38d28c51f3e90aa7336dfa8e7910df074f4`;
- CI terminal verde antes da publicação;
- registry runtime de mídia de sessão deixou de ficar vazio e passou a usar as 11 associações `verified-public` reais;
- 11 sessões x WhatsApp/Discord responderam com título/resumo e hero corretos;
- 11 imagens sociais distintas foram observadas no HTML de crawler;
- 22 imagens R2 foram revalidadas por GET/tamanho/SHA-256 antes do release;
- nenhuma migration, CAS, DNS ou mudança de permissões foi executada por esse release.

Regra de revisão daí em diante: teste com manifesto injetado prova o helper, **não a integração**. Toda superfície pública compartilhável precisa exercer o caminho default real e emitir metadata própria quando houver arte elegível. Fallback é somente ausência de arte elegível.

## Cloudflare R2

O owner técnico é [Integração Cloudflare R2](integrations/r2.md); a operação das 22 imagens está em [Reparo do site e entrega pública de imagens](integrations/media-public-delivery-2026-09-07.md).

Estado atual:

- `tda-media-public` contém o conjunto revisado das 22 imagens de sessão;
- `media.dnd.faysk.dev` possui entrega HTTPS pública verificada para esse conjunto;
- private/preview não possuem entrega pública;
- o registry de metadata pode usar esses assets porque a evidência `verified-public` foi promovida ao runtime;
- isso **não significa** que `sessions.metadata.coverImageUrl`/`heroImageUrl` já apontem para R2;
- troca das referências continua uma operação CAS/transacional separada, com snapshot e rollback próprios;
- nova mídia de entities/lore deve passar pelo mesmo boundary de integridade, audience e entrega pública antes de virar arte social elegível.

Balde é a frente ativa da nova rodada para mídia/R2. Ela não cria outro metadata builder e não refaz a promoção runtime já comprovada da Production #003.

## Supabase e migrations

O projeto `dmrqnbdvbkfqzctcerbx` continua sendo a única base.

Migrations do reboot comprovadamente aplicadas anteriormente incluem:

- `20260906210333_align_tda_domain_identity`;
- `20260906210427_backfill_narrative_entity_links`;
- `20260906211040_relax_reboot_entity_name_lookup`;
- `20260907084234_add_transcript_segment_revision`.

A migration `20260907115300_edit_transcript_segment_atomic` está versionada na linha integrada, mas **integração no Git não prova aplicação remota**. Enquanto não houver execução deliberada + verificação no runbook de banco, documentação e UX não devem tratar a RPC como persistence disponível em production.

A Production #004 não alterou migrations, grants, RLS, RPCs, profiles nem dados. A inclusão de uma publishable key no ambiente Vercel não concede capability de aplicação e não muda autorização do banco.

O domínio Edit continua deny-by-default fora dos boundaries server-side autorizados. Parafuso coordena a convergência Auth/capability + adapter + optimistic concurrency/audit; migration e retirada de bypass são gates separados.

## Discord Auth

O contrato canônico está em [Identidade, Auth e autorização](domains/identity-access.md), e a configuração operacional em [Login Discord](operations/discord-auth.md).

Estado que pode ser afirmado após Production #004:

- Supabase Auth é o boundary de autenticação;
- provider Discord foi observado habilitado no GoTrue em verificação read-only anterior;
- código SSR/PKCE, sessão server-side e guards fazem parte da linha integrada;
- `SUPABASE_PUBLISHABLE_KEY` e `TDA_AUTH_ORIGIN=https://dnd.faysk.dev` estão configurados no target Production conforme evidência operacional desta rodada;
- `/entrar` está habilitado e o início do fluxo redireciona até `discord.com`;
- `/api/auth/me` preserva o estado anônimo sem capabilities para visitante não autenticado;
- **OAuth real, consentimento, callback completo, profile resolvido e permissions/capabilities reais ainda não foram comprovados**.

Secrets de Discord/Supabase não pertencem ao Git, chat, screenshot ou bundle do browser. A publishable key é pública por natureza, mas seu valor não precisa ser duplicado em documentação.

## Ambientes e deployment

A política permanece:

- `git.deploymentEnabled=false`;
- merge/push não publica;
- Preview não recebe credencial/configuração de production por conveniência;
- cada deployment registra source SHA, target, smoke e rollback em `operations/deployments.md`;
- migrations, CAS, DNS, provider configuration e deploy são operações independentes;
- uma rodada paralela de desenvolvimento pode integrar código coordenadamente sem transformar todas essas operações em uma única publicação.

A nova rodada autorizada e suas frentes Pipoca/Claquete/Espaguete/Parafuso/Catraca/Contador/Balde/Carteiro estão indexadas no [Roadmap](roadmap.md). O detalhe continua nos owners de cada área.

## Custos e processamento

Somente franquias gratuitas/Hobby quando possível; nenhum serviço pago deve ser habilitado por conveniência. R2 Standard possui franquia, não gratuidade ilimitada. O projeto não deve assumir que excedentes são bloqueados automaticamente.

Processamento pesado e áudio bruto permanecem locais conforme ADR-0003. R2 pode receber binários públicos/revisados e derivados autorizados, mas não vira arquivo obrigatório de áudio bruto nem substitui o companion local.

O consumidor cloud de sync/bundles coordenado por Carteiro deve preservar idempotência, receipt e retry seguro sem mover processamento pesado para a cloud por conveniência; os owners atuais são [Companion local](integrations/local-companion.md), [Processing](domains/processing.md) e [Fluxos ponta a ponta](architecture/data-flows.md).
