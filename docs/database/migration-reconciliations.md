# Reconciliações do migration history

> Status: vigente
> Owner: dados/Supabase + operations
> Última revisão: 2026-09-10
> Projeto canônico: `dmrqnbdvbkfqzctcerbx`

Este documento registra reconciliações **nominais** entre arquivos locais e entradas já existentes no migration history remoto. Reconciliação nominal não executa DDL: o SQL precisa permanecer byte-identical ao blob local previamente validado e a entrada remota precisa já existir no projeto canônico.

O manifesto machine-readable é `supabase/migration-reconciliations.json` e o guard `tools/ci/check-migrations.mjs` permite somente os renames explicitamente listados nele com o Git blob SHA esperado.

## 2026-09-10 — bootstrap da esteira CI/CD

A preparação do Production CD exigiu que `supabase/migrations` pudesse representar apenas migrations deployáveis sem drift nominal conhecido. O migration history remoto foi consultado antes da mudança e confirmou as entradas:

| Arquivo local anterior | ID/arquivo reconciliado | Git blob SHA | Operação |
| --- | --- | --- | --- |
| `20260909173000_world_edit_lease.sql` | `20260909205836_world_edit_lease.sql` | `03acf691a906a7ae6b18b3ea1b8cdc9d28e3579e` | rename local somente |
| `20260909215000_world_graph_authoring.sql` | `20260910002529_world_graph_authoring.sql` | `79fe04adb641baff431e18487f82f36b31bf65eb` | rename local somente |
| `20260910005000_world_graph_provenance_guard.sql` | `20260910012546_world_graph_provenance_guard.sql` | `84ad42e5e488e9b611668ccdabe138f8b38114fe` | rename local somente |

Nenhum SQL foi alterado e nenhuma migration foi reaplicada para fazer essa reconciliação.

Na mesma preparação, SQL explicitamente documentado como **candidato/não aplicado** foi retirado de `supabase/migrations` e preservado byte-identical em `supabase/candidates`:

- `20260907193704_transcript_import_capability.sql`;
- `20260907193705_transcript_import_atomic.sql`;
- `20260908231000_backfill_screacky_historical_alias.sql`.

Essa separação muda a semântica operacional do repositório: `supabase/migrations` significa autorizado para aplicação pelo fluxo de Production; `supabase/candidates` significa ensaio/evidência ainda fora do `db push`.

## Regra futura

- não editar migration já integrada para alinhar history;
- divergência nominal nova exige inspeção remota e registro neste documento + manifesto antes de qualquer rename;
- candidato aprovado não volta para `migrations` com timestamp antigo: criar migration nova com timestamp atual e revisar contra o schema vigente;
- não usar `--include-all` para contornar candidatos/histórico sem um runbook deliberado;
- rollback de aplicação não edita migration history para fingir que uma DDL nunca existiu.
