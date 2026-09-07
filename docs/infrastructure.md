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
| Production vigente | **Production #006**, source SHA `7dd4b06d1a246ad924230530c2a0424e830aa46d`, deployment `dpl_8cS1DGKStTdmos27wYoa747JRZ6a` |
| Site/domínio | `https://dnd.faysk.dev` ativo sobre o projeto `tda` |
| Metadata pública | 11 sessões verificadas com título/resumo/artwork próprios no crawler; registry runtime real promovido desde Production #003 e preservado na linha publicada da #006 |
| R2 `tda-media-public` | 22 imagens de sessão publicadas e verificadas em `https://media.dnd.faysk.dev`; `r2.dev` desativado |
| R2 `tda-media-private` | privado |
| R2 `tda-media-preview` | privado e isolado de production |
| Referências de sessão no banco | continuam nas origens funcionais atuais; promoção CAS para R2 **não executada** |
| Supabase `dmrqnbdvbkfqzctcerbx` | base única existente; nenhuma migration/grant/escrita de DB fez parte da Production #006 |
| Discord Auth | OAuth real, conta autorizada, navegação e logout verificados em Production #006 |
| Vercel legado `DND/dnd-scribe` | retirado; não é rollback do reboot |

O histórico detalhado e append-only de cada release está em [deployments](operations/deployments.md). Production #006 é a referência publicada, mesmo que a `main` receba commits posteriores de documentação ou candidatos: **source publicado e head do Git são identidades distintas**.

## Publicação e evidências históricas

A Production #006 adicionou `TDA_READ_EDIT_DATA=true` somente no ambiente Production para o resolvedor server-only consultar perfis e permissões existentes. Não habilitou unsafe nem concedeu roles. OAuth real, conta, estatísticas, consulta de permissões, painel desconectado e logout foram verificados.

Os recibos append-only das Productions #003, #004, #005 e #006 permanecem em [deployments](operations/deployments.md), incluindo source, configuração, limitações e rollback. Os ensaios incompletos das releases anteriores são históricos e não substituem o resultado posterior da #006.

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

Balde mantém a operação de mídia/R2 após a integração da preparação #54. Ela não cria outro metadata builder e não refaz a promoção runtime já comprovada da Production #003.

## Supabase e migrations

O projeto `dmrqnbdvbkfqzctcerbx` continua sendo a única base.

Migrations do reboot comprovadamente aplicadas anteriormente incluem:

- `20260906210333_align_tda_domain_identity`;
- `20260906210427_backfill_narrative_entity_links`;
- `20260906211040_relax_reboot_entity_name_lookup`;
- `20260907084234_add_transcript_segment_revision`.

As migrations de importação `20260907193704_transcript_import_capability` e `20260907193705_transcript_import_atomic` também estão integradas, sem aplicação remota; endpoints permanecem negados conforme o [contrato de importação](integrations/transcript-import.md).

A migration `20260907115300_edit_transcript_segment_atomic` está versionada na linha integrada, mas **integração no Git não prova aplicação remota**. Enquanto não houver execução deliberada + verificação no runbook de banco, documentação e UX não devem tratar a RPC como persistence disponível em production.

A Production #006 não alterou migrations, grants, RLS, RPCs, profiles nem dados. A inclusão de uma publishable key no ambiente Vercel não concede capability de aplicação e não muda autorização do banco.

O domínio Edit continua deny-by-default fora dos boundaries server-side autorizados. Parafuso coordena a convergência Auth/capability + adapter + optimistic concurrency/audit; migration e retirada de bypass são gates separados.

## Discord Auth

O contrato canônico está em [Identidade, Auth e autorização](domains/identity-access.md), e a configuração operacional em [Login Discord](operations/discord-auth.md).

Estado comprovado na Production #006:

- Supabase Auth é o boundary de autenticação;
- provider Discord foi observado habilitado no GoTrue em verificação read-only anterior;
- código SSR/PKCE, sessão server-side e guards fazem parte da linha integrada;
- `SUPABASE_PUBLISHABLE_KEY` e `TDA_AUTH_ORIGIN=https://dnd.faysk.dev` estão configurados no target Production conforme evidência operacional desta rodada;
- `/entrar` está habilitado e o início do fluxo redireciona até `discord.com`;
- `/api/auth/me` preserva o estado anônimo sem capabilities para visitante não autenticado;
- **OAuth real, consentimento, retorno, conta autorizada, navegação e logout foram verificados; o nome do aplicativo Discord ainda é DND-SCRIBE**.

Secrets de Discord/Supabase não pertencem ao Git, chat, screenshot ou bundle do browser. A publishable key é pública por natureza, mas seu valor não precisa ser duplicado em documentação.

## Ambientes e deployment

A política permanece:

- `git.deploymentEnabled=false`;
- merge/push não publica;
- Preview não recebe credencial/configuração de production por conveniência;
- cada deployment registra source SHA, target, smoke e rollback em `operations/deployments.md`;
- migrations, CAS, DNS, provider configuration e deploy são operações independentes;
- uma rodada paralela de desenvolvimento pode integrar código coordenadamente sem transformar todas essas operações em uma única publicação.

As prioridades estão no [Roadmap](roadmap.md); PRs e evidências correntes ficam no [inventário de entregas](delivery/inventory.md). O detalhe continua nos owners de cada área.

## Custos e processamento

Somente franquias gratuitas/Hobby quando possível; nenhum serviço pago deve ser habilitado por conveniência. R2 Standard possui franquia, não gratuidade ilimitada. O projeto não deve assumir que excedentes são bloqueados automaticamente.

Processamento pesado e áudio bruto permanecem locais conforme ADR-0003. R2 pode receber binários públicos/revisados e derivados autorizados, mas não vira arquivo obrigatório de áudio bruto nem substitui o companion local.

O consumidor cloud de sync/bundles coordenado por Carteiro deve preservar idempotência, receipt e retry seguro sem mover processamento pesado para a cloud por conveniência; os owners atuais são [Companion local](integrations/local-companion.md), [Processing](domains/processing.md) e [Fluxos ponta a ponta](architecture/data-flows.md).
