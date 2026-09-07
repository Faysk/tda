# Catálogo documental gerado

Gerado por `pnpm docs:generate`; não editar manualmente. O [índice editorial](../README.md) continua sendo a entrada canônica. Este catálogo localiza páginas e lacunas de metadados sem duplicar contratos.

Datas e estados são extraídos do cabeçalho, não inferidos do Git. `Não declarado` é lacuna de metadados, não ausência de implementação. O catálogo não concede aprovação nem substitui evidências.

## docs

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [Documentação TDA](../README.md) | documentação/arquitetura | vigente | 2026-09-07 |
| [Arquitetura](../architecture.md) | Não declarado | Não declarado | Não declarado |
| [Modelo de dados canônico](../data-model.md) | Não declarado | Não declarado | Não declarado |
| [Auditoria do banco de produção](../database-audit.md) | Não declarado | Não declarado | Não declarado |
| [Catálogo canônico de features](../feature-catalog.md) | produto / arquitetura | vigente | 2026-09-07 |
| [Infraestrutura e estado](../infrastructure.md) | infraestrutura/operação | vigente; production ativa | 2026-09-07 |
| [Publicação controlada](../releases.md) | Não declarado | Não declarado | Não declarado |
| [Roadmap](../roadmap.md) | produto / arquitetura | vigente | 2026-09-07 |

## docs/adr

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [ADR-0001 — TDA como identidade canônica; dnd-scribe como legado](../adr/0001-project-identity.md) | Não declarado | accepted | Não declarado |
| [ADR-0002 — Reutilizar o Supabase existente como única base](../adr/0002-existing-supabase.md) | Não declarado | accepted | Não declarado |
| [ADR-0003 — Processamento pesado local; produto cloud](../adr/0003-local-heavy-processing.md) | Não declarado | accepted | Não declarado |
| [ADR-0004 — Registry única de entities para PC, NPC e mundo](../adr/0004-canonical-entities.md) | Não declarado | accepted | Não declarado |
| [ADR-0005 — Canon exige fonte e revisão](../adr/0005-canon-review-gate.md) | Não declarado | accepted | Não declarado |
| [ADR-0006 — React Flow como engine de visualização do World Explorer](../adr/0006-react-flow-world-explorer.md) | frontend / narrative-memory | aceito | Não declarado |
| [ADR-0007 — Edit como workbench server-first orientado a capabilities](../adr/0007-edit-workbench.md) | Não declarado | Não declarado | Não declarado |
| [ADR-0008 — autorização orientada a capabilities e scope](../adr/0008-capability-authorization.md) | identity/access + arquitetura + segurança | accepted | Não declarado |
| [Architecture Decision Records](../adr/README.md) | arquitetura | vigente | Não declarado |

## docs/architecture

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [Arquitetura — índice detalhado](../architecture/README.md) | arquitetura do TDA | vigente | 2026-09-07 |
| [Fluxos ponta a ponta](../architecture/data-flows.md) | arquitetura + domínios | vigente/parcialmente preparado | 2026-09-06 |
| [Arquitetura do Edit Workbench](../architecture/edit-workbench.md) | arquitetura + Edit | accepted / implementação incremental | 2026-09-07 |
| [Princípios e invariantes](../architecture/invariants.md) | arquitetura | vigente | 2026-09-06 |
| [Contexto e limites do sistema](../architecture/system-context.md) | arquitetura | vigente | 2026-09-06 |

## docs/database

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [Banco de dados — índice](../database/README.md) | dados/Supabase | vigente | 2026-09-07 |
| [Migrations e evolução do schema](../database/migrations.md) | dados/Supabase | vigente | 2026-09-07 |
| [Relacionamentos e ownership de dados](../database/relationships.md) | dados + domínios | vigente | 2026-09-06 |
| [Inventário de RPCs privilegiadas do Supabase](../database/rpc-inventory.md) | segurança/dados | vigente / revisão de hardening em andamento | Não declarado |
| [Catálogo do schema Supabase](../database/schema-catalog.md) | dados/Supabase | implementado | 2026-09-06 |
| [Segurança do banco: Auth, RLS, RBAC, RPCs e grants](../database/security.md) | segurança/dados | implementado + transição em andamento | 2026-09-07 |
| [Log de verificações do banco de produção](../database/verification-log.md) | dados/Supabase | vigente / append-only por intenção | Não declarado |

## docs/delivery

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [Gestão de entregas](../delivery/README.md) | Prancheta - Organização de entregas | preparado | 2026-09-07 |
| [Inventário de entregas](../delivery/inventory.md) | Prancheta - Organização de entregas | preparado | 2026-09-07 |
| [Medição de esforço e qualidade](../delivery/measurement.md) | Prancheta - Organização de entregas | preparado | 2026-09-07 |
| [Composição de candidato e marcos](../delivery/release-candidate.md) | Prancheta - Organização de entregas; decisão de escopo por Polvo - Coordenação e produto | preparado | 2026-09-07 |
| [Fluxo de entregas](../delivery/workflow.md) | Prancheta - Organização de entregas; execução por Polvo - Coordenação | preparado | 2026-09-07 |

## docs/design-system

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [Design System oficial do TDA](../design-system/README.md) | design-system / frontend | canônico; fundação runtime e superfícies públicas implementadas | 2026-09-07 |
| [Plano de migração do Design System para o reboot](../design-system/migration-plan.md) | design-system / frontend | DS-1/DS-2/DS-3 concluídas; DS-4 parcial; DS-5 implementada; DS-7 cleanup legado aplicado | 2026-09-07 |
| [Assets oficiais da marca TDA](../design-system/official-assets.md) | brand / design-system | canônico para marca; integração runtime parcial e verificável | 2026-09-06 |
| [Superfícies públicas — ownership visual e composição](../design-system/public-surfaces.md) | design-system / frontend público | implementado; atualizado após Home V2 e shell responsiva | 2026-09-07 |
| [World Explorer — composição e UX oficial](../design-system/world-explorer-ui.md) | product / design-system / narrative-memory | direção visual aprovada; implementação pendente | 2026-09-06 |

## docs/documentation

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [Documentação viva](README.md) | documentação/arquitetura | vigente | 2026-09-07 |
| [ADR-NNNN — Título](adr-template.md) | Não declarado | proposed  /  accepted  /  superseded  /  rejected | Não declarado |
| [Template de documento](document-template.md) | Não declarado | Não declarado | Não declarado |

## docs/domains

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [Domínios do TDA](../domains/README.md) | produto/arquitetura | vigente | 2026-09-06 |
| [Canon, revisão e publicação](../domains/canon-review.md) | review/canon | schema implementado; operação integrada ainda preparada/planejada | 2026-09-06 |
| [Entidades, personagens e mundo narrativo](../domains/entities.md) | narrative-memory/entities | preparado | 2026-09-06 |
| [Evidências, transcrição e classificação](../domains/evidence.md) | evidence/transcription | implementado + modernização planejada | 2026-09-06 |
| [Identidade, Auth e autorização](../domains/identity-access.md) | identity/access | arquitetura aprovada + convergência em andamento | 2026-09-07 |
| [Processamento, jobs e áudio](../domains/processing.md) | processing/local-companion | legado funcional + modernização planejada | 2026-09-06 |
| [Campanhas, sessões e participantes](../domains/sessions.md) | sessions | implementado | 2026-09-06 |

## docs/features

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [Especificações de features](../features/README.md) | produto + domínios | vivo | 2026-09-07 |
| [Feature — Personagens e NPCs](../features/characters-and-npcs.md) | entities/narrative-memory | preparado | 2026-09-06 |
| [Feature — Assistente Discord](../features/discord-assistant.md) | integrations/discord + narrative query | histórico/planejado | 2026-09-06 |
| [Edit — consulta de permissões](../features/edit-permissions.md) | identity/access + Edit | implementação candidata, somente leitura | 2026-09-07 |
| [Edit — slice server-side de transcrição](../features/edit-transcript-server-slice.md) | Edit / aplicação + dados | leitura autorizada implementada com revision; mutation canônica preparada; persistence atômica pendente; bypass temporário de UI separado | 2026-09-07 |
| [Edit — modo temporário sem autenticação](../features/edit-unsafe-development.md) | Edit / aplicação + segurança | compatibilidade temporária de desenvolvimento | 2026-09-07 |
| [Edit Workbench — área administrativa do TDA](../features/edit-workbench.md) | Edit / produto + frontend | arquitetura aprovada; implementação incremental em andamento | 2026-09-07 |
| [Feature — Perfis editoriais de entities](../features/entity-profiles.md) | narrative-memory / frontend | preparado; projection publicada pendente | 2026-09-07 |
| [Feature — Timeline por entidade](../features/entity-timeline.md) | narrative-memory | preparado | 2026-09-06 |
| [Feature/conceito — Intents / intenção](../features/intents.md) | não atribuído | **não definido / não encontrado como conceito canônico** | 2026-09-06 |
| [Feature — Conhecimento e audiência](../features/knowledge-audience.md) | narrative-memory/security | em desenho | 2026-09-06 |
| [Feature — Modo sessão ao vivo](../features/live-session.md) | sessions/live | histórico/planejado; fora das entregas imediatas | 2026-09-06 |
| [Processamento local no Edit](../features/local-processing.md) | Processamento UI/adapters (Painelzinho); API/export local: Motorzinho; importação cloud: Carteiro | preparado / implementação candidata | 2026-09-07 |
| [Feature — Mapas narrativos](../features/maps.md) | narrative-memory/maps | em desenho | 2026-09-06 |
| [Feature — Músicas e performances](../features/music-performances.md) | narrative-memory/media | preparado/em desenho | 2026-09-06 |
| [Feature — Quests e ganchos](../features/quests-hooks.md) | narrative-memory | preparado/em desenho | 2026-09-06 |
| [Feature — contrato de dados para relações](../features/relations-data-contract.md) | narrative-memory / database / security | proposta canônica para revisão; **nenhuma DDL aprovada/aplicada ainda** | 2026-09-06 |
| [Feature — Relações entre entidades e grafo](../features/relations-graph.md) | narrative-memory | arquitetura visual aprovada; schema de relations em desenho | 2026-09-06 |
| [Feature — Busca semântica com fontes](../features/semantic-search.md) | search/narrative-memory | em desenho | 2026-09-06 |
| [Estatísticas privadas de transcrições](../features/transcript-statistics.md) | transcrições / leitura e estatísticas | implementação candidata em branch; não publicada | 2026-09-07 |
| [Feature — World Explorer / Ecos da Jornada](../features/world-explorer.md) | narrative-memory / frontend | arquitetura aprovada; vertical slice visual em implementação | 2026-09-07 |

## docs/integrations

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [Integrações — índice](../integrations/README.md) | integrations | vigente/parcialmente preparado | 2026-09-07 |
| [Companion — protocolo local v1](../integrations/local-companion-v1.md) | local-companion/processing | implementado em branch/PR; fixture sintética | 2026-09-07 |
| [Companion local](../integrations/local-companion.md) | local-companion/processing | base sintética implementada em branch/PR; ASR real legado preservado | 2026-09-07 |
| [Inventário de mídia — 2026-09-07](../integrations/media-inventory-2026-09-07.md) | integrations/media | auditoria observada | Não declarado |
| [Reparo do site e entrega pública de imagens](../integrations/media-public-delivery-2026-09-07.md) | integrations/media | implementado parcialmente; promoção R2 pendente | 2026-09-07 |
| [Recuperação de imagens — 2026-09-07](../integrations/media-recovery-2026-09-07.md) | integrations/media | auditoria observada | 2026-09-07 |
| [Integração Cloudflare R2](../integrations/r2.md) | integrations/media | preparado | 2026-09-07 |
| [Integração Supabase](../integrations/supabase.md) | integrations + data + identity | implementado/canônico | 2026-09-06 |
| [Craig, Discord e Roll20](../integrations/table-sources.md) | integrations/table-sources | legado funcional/parcialmente implementado | 2026-09-06 |
| [Importação de transcrição local](../integrations/transcript-import.md) | sync/consumer + dados/Supabase | implementado em branch/PR; ativação negada | 2026-09-07 |
| [Integração Vercel](../integrations/vercel.md) | operations/hosting | production ativa; publicação manual controlada | 2026-09-07 |

## docs/legacy

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [Legado e fontes históricas — `Faysk/dnd-scribe`](../legacy/README.md) | documentação/arquitetura | histórico/referência | 2026-09-07 |
| [Edit — paridade com `Faysk/dnd-scribe`](../legacy/edit-parity.md) | Edit + arquitetura | vivo; auditoria inicial concluída para transcript/access | 2026-09-07 |

## docs/operations

| Documento | Owner declarado | Estado declarado | Revisão declarada |
| --- | --- | --- | --- |
| [Operação — índice](../operations/README.md) | operations | vigente | 2026-09-07 |
| [Runbook operacional do banco / Supabase](../operations/database-runbook.md) | dados/Supabase | vigente | 2026-09-07 |
| [Histórico de deployments](../operations/deployments.md) | operations | vigente | Não declarado |
| [Login Discord: configuração e verificação](../operations/discord-auth.md) | identity/access | Auth integrado; correção de Origin candidata, sem deploy; OAuth completo ainda não comprovado por esta tarefa | 2026-09-07 |
| [Ambientes e configuração](../operations/environments.md) | operations | vigente | 2026-09-07 |
| [Retirada do projeto Vercel legado](../operations/legacy-retirement.md) | infraestrutura/operação | executado e verificado | 2026-09-07 |
| [Companion — operação, migração e rollback](../operations/local-companion.md) | local-companion/processing | preparado; base executável sintética em branch/PR | 2026-09-07 |
| [Runbook — release, deploy e rollback](../operations/release-runbook.md) | operations/release | vigente | 2026-09-07 |
| [Checklist de segurança operacional](../operations/security-checklist.md) | security/operations | vigente | 2026-09-07 |

## Cobertura

92 páginas inventariadas, além deste catálogo gerado. 12 sem Owner e 19 sem Última revisão no cabeçalho. Corrigir durante revisão real; não preencher datas automaticamente.
