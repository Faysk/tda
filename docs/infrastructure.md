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
| Production vigente | **Production #003**, source SHA `0120e38d28c51f3e90aa7336dfa8e7910df074f4` |
| Site/domínio | `https://dnd.faysk.dev` ativo sobre o projeto `tda` |
| Metadata pública | 11 sessões verificadas com título/resumo/artwork próprios no crawler; registry runtime real promovido |
| R2 `tda-media-public` | 22 imagens de sessão publicadas e verificadas em `https://media.dnd.faysk.dev`; `r2.dev` desativado |
| R2 `tda-media-private` | privado |
| R2 `tda-media-preview` | privado e isolado de production |
| Referências de sessão no banco | continuam nas origens funcionais atuais; promoção CAS para R2 **não executada** |
| Supabase `dmrqnbdvbkfqzctcerbx` | base única existente; migrations aplicadas continuam separadas das migrations apenas integradas em código |
| Discord Auth | runtime/guards integrados; configuração/OAuth real de production continua frente operacional própria |
| Vercel legado `DND/dnd-scribe` | retirado; não é rollback do reboot |

O histórico detalhado e append-only de cada release está em [deployments](operations/deployments.md). Production #003 é a referência publicada, mesmo que a `main` receba commits posteriores de documentação ou candidatos: **source publicado e head do Git são identidades distintas**.

## Production #003

A Production #003 corrigiu a regressão de metadata individual sem promover referências de banco para R2.

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

O domínio Edit continua deny-by-default fora dos boundaries server-side autorizados. Parafuso coordena a convergência Auth/capability + adapter + optimistic concurrency/audit; migration e retirada de bypass são gates separados.

## Discord Auth

O contrato canônico está em [Identidade, Auth e autorização](domains/identity-access.md), e a configuração operacional em [Login Discord](operations/discord-auth.md).

Estado que pode ser afirmado:

- Supabase Auth é o boundary de autenticação;
- provider Discord foi observado habilitado no GoTrue em verificação read-only anterior;
- código SSR/PKCE, sessão server-side e guards já fazem parte da linha integrada;
- Production #002 registrou `/entrar` indisponível sem configuração suficiente no ambiente;
- Production #003 não alterou Auth;
- callback/consentimento/login real de production ainda precisam de evidência própria antes de declarar Catraca concluída.

Secrets de Discord/Supabase não pertencem ao Git, chat, screenshot ou bundle do browser.

## Ambientes e deployment

A política permanece:

- `git.deploymentEnabled=false`;
- merge/push não publica;
- Preview não recebe credencial de production por conveniência;
- cada deployment registra source SHA, target, smoke e rollback em `operations/deployments.md`;
- migrations, CAS, DNS, provider configuration e deploy são operações independentes;
- uma rodada paralela de desenvolvimento pode integrar código coordenadamente sem transformar todas essas operações em uma única publicação.

A nova rodada autorizada e suas frentes Pipoca/Claquete/Espaguete/Parafuso/Catraca/Contador/Balde estão indexadas no [Roadmap](roadmap.md). O detalhe continua nos owners de cada área.

## Custos e processamento

Somente franquias gratuitas/Hobby quando possível; nenhum serviço pago deve ser habilitado por conveniência. R2 Standard possui franquia, não gratuidade ilimitada. O projeto não deve assumir que excedentes são bloqueados automaticamente.

Processamento pesado e áudio bruto permanecem locais conforme ADR-0003. R2 pode receber binários públicos/revisados e derivados autorizados, mas não vira arquivo obrigatório de áudio bruto nem substitui o companion local.
