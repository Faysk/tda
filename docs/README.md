# Documentação TDA

> **Fonte de verdade do reboot.** Esta árvore documenta o produto, a arquitetura, o banco, a operação e as decisões vigentes do `Faysk/tda`.
>
> `Faysk/dnd-scribe` é referência histórica. Nenhuma decisão, status ou arquitetura do legado passa a valer no TDA sem revalidação explícita e registro aqui.

## Como ler esta documentação

A documentação é organizada em camadas para continuar navegável quando o projeto crescer:

1. **Visão e estado** — o que é o TDA, onde estamos e para onde vamos.
2. **Arquitetura** — limites do sistema, componentes, fluxos e invariantes.
3. **Design System** — identidade visual oficial, tokens, assets e composição.
4. **Domínios** — regras de negócio e ownership conceitual.
5. **Banco** — schema real, segurança, migrations e dívida técnica.
6. **Features** — catálogo e especificações de capacidades implementadas, preparadas e planejadas.
7. **Integrações** — contratos com serviços externos.
8. **Operação** — ambientes, release, deploy, rollback e runbooks.
9. **Decisões** — ADRs que explicam por que escolhas estruturais foram feitas.
10. **Legado** — o que foi herdado, revalidado, substituído ou descartado.

## Índice canônico

### Produto e direção

- [Roadmap](roadmap.md) — entregas e ordem de evolução.
- [Catálogo de features](feature-catalog.md) — status canônico de cada feature.
- [Infraestrutura e estado](infrastructure.md) — inventário operacional atual.
- [Versões verificadas](versions.json) — versões de runtime/ferramentas deliberadamente fixadas.

### Arquitetura

- [Arquitetura — visão executiva](architecture.md)
- [Arquitetura — índice detalhado](architecture/README.md)
- [Contexto e limites do sistema](architecture/system-context.md)
- [Fluxos ponta a ponta](architecture/data-flows.md)
- [Princípios e invariantes](architecture/invariants.md)
- [Edit Workbench — boundary administrativo](architecture/edit-workbench.md)

### Design System e marca

- [Design System oficial](design-system/README.md) — TDA Design System v1.0.0, tokens, princípios e migração para o reboot.
- [Plano de migração visual](design-system/migration-plan.md) — fases para introduzir tokens, primitives e assets sem big bang.
- [Assets oficiais da marca](design-system/official-assets.md) — TDA Brand Pack, masters, logo, pato, favicon/PWA/social.
- [World Explorer — composição e UX](design-system/world-explorer-ui.md) — tradução das referências visuais aprovadas para contrato de interface.

### Modelo de dados e banco

- [Modelo de dados canônico](data-model.md) — vocabulário e identidades do domínio.
- [Banco — índice](database/README.md)
- [Catálogo das 43 tabelas públicas](database/schema-catalog.md)
- [Relacionamentos e ownership](database/relationships.md)
- [RLS, RBAC, RPCs e segurança](database/security.md)
- [Migrations e evolução do schema](database/migrations.md)
- [Auditoria do banco de produção](database-audit.md) — fotografia observada, não substitui o contrato.

### Domínios

- [Domínios — índice](domains/README.md)
- [Identidade, Auth e autorização](domains/identity-access.md)
- [Campanhas, sessões e participantes](domains/sessions.md)
- [Evidências, transcrição e classificação](domains/evidence.md)
- [Entidades, personagens e mundo narrativo](domains/entities.md)
- [Canon, revisão e publicação](domains/canon-review.md)
- [Processamento, jobs e áudio](domains/processing.md)

### Features e expansão

- [Especificações de features — índice](features/README.md)
- [Edit Workbench / administração](features/edit-workbench.md)
- [Personagens e NPCs](features/characters-and-npcs.md)
- [Perfis editoriais de entities](features/entity-profiles.md)
- [World Explorer / Ecos da Jornada](features/world-explorer.md)
- [Relações e grafo](features/relations-graph.md)
- [Contrato proposto de relations](features/relations-data-contract.md)
- [Conhecimento e audiência](features/knowledge-audience.md)
- [Timeline por entidade](features/entity-timeline.md)
- [Busca semântica](features/semantic-search.md)
- [Mapas narrativos](features/maps.md)
- [Músicas e performances](features/music-performances.md)
- [Quests e ganchos](features/quests-hooks.md)
- [Sessão ao vivo](features/live-session.md)
- [Assistente Discord](features/discord-assistant.md)
- [Intents / intenção — conceito ainda não definido](features/intents.md)

### Integrações

- [Integrações — índice](integrations/README.md)
- [Supabase](integrations/supabase.md)
- [Cloudflare R2](integrations/r2.md)
- [Vercel](integrations/vercel.md)
- [Craig, Discord e Roll20](integrations/table-sources.md)
- [Companion local](integrations/local-companion.md)

### Operação

- [Operação — índice](operations/README.md)
- [Ambientes e configuração](operations/environments.md)
- [Login Discord — configuração e verificação](operations/discord-auth.md)
- [Release, deploy e rollback](operations/release-runbook.md)
- [Publicação controlada](releases.md) — política resumida.
- [Segurança operacional](operations/security-checklist.md)

### Decisões arquiteturais

- [ADRs — índice](adr/README.md)
- [ADR-0001 — TDA como identidade canônica; dnd-scribe como legado](adr/0001-project-identity.md)
- [ADR-0002 — Supabase existente como única base](adr/0002-existing-supabase.md)
- [ADR-0003 — processamento pesado local; cloud para produto e conteúdo sincronizado](adr/0003-local-heavy-processing.md)
- [ADR-0004 — registry única de entities para PC/NPC/mundo](adr/0004-canonical-entities.md)
- [ADR-0005 — canon exige fonte e revisão](adr/0005-canon-review-gate.md)
- [ADR-0006 — React Flow como engine do World Explorer](adr/0006-react-flow-world-explorer.md)
- [ADR-0007 — Edit como workbench server-first orientado a capabilities](adr/0007-edit-workbench.md)
- [ADR-0008 — autorização orientada a capabilities e scope](adr/0008-capability-authorization.md)

### Governança da própria documentação

- [Documentação viva — política e manutenção](documentation/README.md)
- [Catálogo completo gerado e lacunas de metadados](documentation/catalog.md)
- [Retirada do projeto Vercel legado](operations/legacy-retirement.md)
- [Template de documento](documentation/document-template.md)
- [Template de ADR](documentation/adr-template.md)
- [Registro de fontes históricas](legacy/README.md)
- [Edit — matriz de paridade com o legado](legacy/edit-parity.md)

## Status usados em todos os docs

| Status | Significado |
| --- | --- |
| **implementado** | existe e é utilizável no sistema/schema vigente |
| **preparado** | estrutura existe, mas operação/UI/população ainda não está completa |
| **arquitetura aprovada** | boundary/UX/tecnologia principal aceitos; implementação ainda pode estar pendente |
| **planejado** | direção aprovada no reboot; implementação ainda não iniciada |
| **em desenho** | objetivo aceito, porém contrato ainda precisa ser fechado |
| **legado compatível** | continua operando apenas para não quebrar a transição |
| **histórico** | referência útil do `dnd-scribe`, sem autoridade sobre o reboot |
| **fora de escopo** | explicitamente não pertence à entrega/arquitetura atual |

## Regras de manutenção

- Mudança estrutural de código, schema, segurança, integração ou operação **deve atualizar o documento dono do assunto na mesma PR**.
- Mudança visual sistêmica deve atualizar o documento/tokens donos em `docs/design-system/`.
- DDL aplicada no Supabase deve possuir migration versionada em `supabase/migrations` com a mesma versão registrada remotamente.
- Feature futura primeiro recebe contrato/documentação; depois schema/código.
- Não duplicar fatos: um documento é canônico e os demais apontam para ele.
- Auditorias com data descrevem uma fotografia; contratos descrevem a regra vigente.
- Não armazenar secrets, tokens de autenticação, chaves ou dados privados na documentação.
- Decisões irreversíveis ou de alto impacto recebem ADR.
- Assets de marca não são redesenhados fora do Brand Pack oficial.
- `pnpm docs:check` valida recursivamente links Markdown e falha se houver documento órfão fora da árvore deste índice.

## Identidades e fontes fixas atuais

- Produto: `tda`.
- Campanha principal: `yuhara-main`.
- Supabase: `dmrqnbdvbkfqzctcerbx`.
- Repositório vigente: `Faysk/tda`.
- Legado: `Faysk/dnd-scribe`.
- Design System oficial: `TDA Design System v1.0.0` fornecido em 2026-09-06.
- Brand Pack oficial: `TDA — Tem Dado Aqui — Brand Pack` fornecido em 2026-09-06.
- World Explorer: React Flow (`@xyflow/react`) como engine de visualização, domínio independente.
- Transcrição pesada: local.
- Binários cloud: Cloudflare R2, separados por visibilidade/ambiente.
- Vercel correta para futuras operações: conta/contexto `projeto-desenv-6905` / `projeto_desenv@outlook.com`.

Última revisão estrutural: **2026-09-07**.
