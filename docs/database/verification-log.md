# Log de verificações do banco de produção

> Status: vigente / append-only por intenção
> Owner: dados/Supabase
> Projeto canônico: `dmrqnbdvbkfqzctcerbx`

Este documento registra verificações pontuais do estado real do Supabase. Ele complementa `database-audit.md`: a auditoria descreve uma fotografia mais ampla; este log registra revalidações operacionais menores e frequentes.

Entradas novas devem ser adicionadas no topo, preservando as anteriores.

---

## 2026-09-07 — revalidação pós-reboot

### Escopo

Revalidação read-only do Supabase de produção contra as migrations e documentação atualmente presentes em `Faysk/tda`.

### Projeto

- project ref: `dmrqnbdvbkfqzctcerbx`;
- nome no Supabase: `DND Scribe`;
- estado observado: `ACTIVE_HEALTHY`;
- PostgreSQL: 17.

O nome legado do projeto no fornecedor não altera o scope canônico do reboot (`project/tda`). Renomear o projeto no fornecedor não é requisito funcional desta etapa.

### Migration history do reboot

Confirmadas no banco remoto:

- `20260906210333 align_tda_domain_identity`;
- `20260906210427 backfill_narrative_entity_links`;
- `20260906211040 relax_reboot_entity_name_lookup`.

Os IDs/nomes correspondem aos arquivos em `supabase/migrations`.

### Objetos estruturais verificados

Confirmados no schema real:

- `entities.aliases`;
- unique index de `(campaign_id, slug)` quando `slug` não é nulo;
- índice de lookup `(campaign_id, lower(name))` não único;
- constraint legada exata `(campaign_id, name)` preservada;
- `profile_characters.entity_id` + FK;
- índice de `profile_characters.entity_id`;
- `participants.character_entity_id` + FK;
- índice de `participants.character_entity_id`;
- índice de `entity_mentions.entity_id`;
- GIN de `entities.aliases`.

### Invariantes de dados

Estado observado:

- `entities`: 3;
- entities `pc`: 3;
- `profile_characters` não-NPC: 3;
- `profile_characters` não-NPC sem `entity_id`: 0;
- `participants`: 18;
- participants com nome: 18;
- participants nomeados sem `character_entity_id`: 6;
- assignments ativos `project/tda`: 2;
- assignments ativos `project/dnd-scribe`: 2.

Os 6 participants sem entity são registros de `DM` e `Convidado / indefinido`, não PCs conhecidos que falharam no backfill. Portanto não foi feito novo backfill.

### Advisors de segurança

O advisor foi executado novamente.

Principais classes observadas:

- diversas tabelas públicas com RLS habilitado e sem policy explícita (`rls_enabled_no_policy`);
- RPCs `SECURITY DEFINER` executáveis por `authenticated`;
- Leaked Password Protection desabilitada no Auth.

Decisão:

- **não** criar policies abertas para silenciar o primeiro aviso: o estado atual é deny-by-default e a superfície pública vigente usa boundary server-side;
- **não** revogar RPCs em massa: consumidores legados precisam ser inventariados função a função antes do Edit público;
- proteção de senha vazada permanece item de hardening caso login por senha seja habilitado; o fluxo atual é orientado a OAuth.

Ver `docs/database/security.md` para o contrato e checklist de segurança.

### Advisors de performance

O advisor foi executado novamente.

Foram observadas várias FKs sem índice cobrindo a coluna e vários índices ainda sem uso registrado, incluindo índices novos do domínio narrativo.

Decisão:

- não criar/remover índices em massa com base apenas no advisor;
- preservar índices das features que ainda estão entrando em uso;
- priorizar otimização baseada em tráfego/query paths reais do TDA.

### Drift

Nenhum drift conhecido foi encontrado entre as três migrations do reboot registradas no Supabase e os arquivos atuais do repositório.

### Ações tomadas

- nenhuma DDL aplicada;
- nenhum dado alterado;
- nenhum grant/policy/RPC alterado;
- criado `docs/operations/database-runbook.md` para padronizar operação, mudança, drift, rollback e incidentes;
- esta verificação foi registrada para manter histórico operacional.

### Estado final da verificação

**Apto para continuidade do desenvolvimento do reboot.**

Pendências conhecidas continuam sendo trabalho planejado, não blockers do estado atual:

1. inventário/hardening das RPCs `SECURITY DEFINER` antes do Edit público;
2. convergência completa do legado para UUID/slug antes de remover a constraint histórica de nome;
3. otimização de índices guiada por uso real;
4. decisão canônica `Screacky` vs `Screaky` e alias correspondente quando aprovada.
