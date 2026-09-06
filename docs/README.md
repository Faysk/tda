# Documentação TDA

> **Fonte de verdade do reboot.** Esta árvore documenta o produto, a arquitetura, o banco, a operação e as decisões vigentes do `Faysk/tda`.
>
> `Faysk/dnd-scribe` é referência histórica. Nenhuma decisão, status ou arquitetura do legado passa a valer no TDA sem revalidação explícita e registro aqui.

## Como ler esta documentação

A documentação é organizada em camadas para continuar navegável quando o projeto crescer:

1. **Visão e estado** — o que é o TDA, onde estamos e para onde vamos.
2. **Arquitetura** — limites do sistema, componentes, fluxos e invariantes.
3. **Domínios** — regras de negócio e ownership conceitual.
4. **Banco** — schema real, segurança, migrations e dívida técnica.
5. **Features** — catálogo e especificações de capacidades implementadas, preparadas e planejadas.
6. **Integrações** — contratos com serviços externos.
7. **Operação** — ambientes, release, deploy, rollback e runbooks.
8. **Decisões** — ADRs que explicam por que escolhas estruturais foram feitas.
9. **Legado** — o que foi herdado, revalidado, substituído ou descartado.

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
- [Personagens e NPCs](features/characters-and-npcs.md)
- [Relações e grafo](features/relations-graph.md)
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

### Governança da própria documentação

- [Documentação viva — política e manutenção](documentation/README.md)
- [Template de documento](documentation/document-template.md)
- [Template de ADR](documentation/adr-template.md)
- [Registro de fontes históricas](legacy/README.md)

## Status usados em todos os docs

| Status | Significado |
| --- | --- |
| **implementado** | existe e é utilizável no sistema/schema vigente |
| **preparado** | estrutura existe, mas operação/UI/população ainda não está completa |
| **planejado** | direção aprovada no reboot; implementação ainda não iniciada |
| **em desenho** | objetivo aceito, porém contrato ainda precisa ser fechado |
| **legado compatível** | continua operando apenas para não quebrar a transição |
| **histórico** | referência útil do `dnd-scribe`, sem autoridade sobre o reboot |
| **fora de escopo** | explicitamente não pertence à entrega/arquitetura atual |

## Regras de manutenção

- Mudança estrutural de código, schema, segurança, integração ou operação **deve atualizar o documento dono do assunto na mesma PR**.
- DDL aplicada no Supabase deve possuir migration versionada em `supabase/migrations` com a mesma versão registrada remotamente.
- Feature futura primeiro recebe contrato/documentação; depois schema/código.
- Não duplicar fatos: um documento é canônico e os demais apontam para ele.
- Auditorias com data descrevem uma fotografia; contratos descrevem a regra vigente.
- Não armazenar secrets, tokens, chaves ou dados privados na documentação.
- Decisões irreversíveis ou de alto impacto recebem ADR.
- `pnpm docs:check` valida recursivamente links Markdown e falha se houver documento órfão fora da árvore deste índice.

## Identidades fixas atuais

- Produto: `tda`.
- Campanha principal: `yuhara-main`.
- Supabase: `dmrqnbdvbkfqzctcerbx`.
- Repositório vigente: `Faysk/tda`.
- Legado: `Faysk/dnd-scribe`.
- Transcrição pesada: local.
- Binários cloud: Cloudflare R2, separados por visibilidade/ambiente.
- Vercel correta para futuras operações: conta/contexto `projeto-desenv-6905` / `projeto_desenv@outlook.com`.

Última revisão estrutural: **2026-09-06**.
