# Auditoria do banco de produção

Revisão: 2026-09-06. Projeto Supabase: `dmrqnbdvbkfqzctcerbx`.

Este documento registra fatos observados no banco. Não transforma automaticamente documentação histórica do `dnd-scribe` em requisito do reboot.

## Estado resumido

O schema público tem RLS habilitado em todas as tabelas observadas. A maior parte das tabelas operacionais não possui policies e, portanto, permanece fechada para acesso direto por roles comuns; o site atual usa uma fronteira server-side controlada para conteúdo publicado.

Dados relevantes observados:

- campanhas: 1 (`yuhara-main`)
- sessões: 11
- profiles: 5
- campaign members: 4
- participants: 18
- transcript segments: 30.857
- segment classifications: 2.488
- canon candidates: 159
- quote candidates: 68
- outtake candidates: 75
- publications: 4
- profile characters: 3
- entities: 0 antes da migration de alinhamento
- entity mentions: 0
- canon entries: 0

## O que já está implementado no schema

### Mundo narrativo
`entities` já aceita `pc`, `npc`, `location`, `item`, `organization`, `faction`, `arc`, `concept`, `song`, `quest` e `other`. Há suporte de audiência/visibilidade e ligação de `canon_entries` e `entity_mentions`.

### Canon e revisão
O banco possui o pipeline `segment_classifications` → candidatos → `review_decisions` → `canon_entries`/`publications`. `canon_candidates` mantém fontes de segmento/Roll20 e IDs de entidades relacionadas.

### Pessoas e personagens
`profiles` representa pessoas/contas. `profile_characters` já contém três PCs ativos, enquanto `entities` estava vazio. Isso criava duas identidades narrativas potenciais; a migration TDA passa a vincular essas camadas.

### Autorização
Há dois modelos coexistindo:

1. `campaign_members.role`, usado por RPCs legadas;
2. RBAC extensível com `permission_catalog`, `role_definitions`, `role_permissions` e `role_assignments`.

O reboot deve convergir para capabilities derivadas do RBAC sem quebrar as RPCs legadas durante a transição.

Scopes observados antes do alinhamento:

- `campaign / yuhara-main`: 18 assignments
- `project / dnd-scribe`: 2 assignments técnicos

O legado ainda possui `PROJECT_SCOPE_ID='dnd-scribe'` hardcoded. Portanto `tda` é adicionado como scope canônico paralelo; o scope antigo só poderá ser removido quando o aplicativo legado deixar de depender dele.

## RLS

RLS está habilitado em todas as tabelas públicas observadas. Tabelas com policies explícitas incluem atualmente:

- `discord_interactions`
- `ordo_access_members`
- `profile_characters`
- `profile_claims`
- `table_notes`

Muitas outras têm RLS sem policy. O Database Linter sinaliza isso como informação, mas esse estado funciona como deny-by-default e é compatível com a fronteira server-side atual. Não adicionar policies abertas apenas para silenciar o lint.

Referência: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## SECURITY DEFINER

O linter marcou RPCs `SECURITY DEFINER` executáveis por usuários autenticados, incluindo helpers e fluxos legados de acesso/revisão. Isso exige revisão por função, não revogação em massa, pois parte delas é deliberadamente exposta pelo sistema legado.

Antes do Edit público:

- catalogar quais RPCs são endpoints intencionais;
- revogar `EXECUTE` de helpers internos que não precisam ser RPC;
- garantir autorização interna em toda função exposta;
- preferir capabilities do RBAC para novas superfícies.

Referência: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

## Performance

O advisor apontou várias foreign keys sem índice cobrindo a coluna. Não será criada uma bateria indiscriminada de índices: cada índice tem custo de escrita/manutenção e várias tabelas pertencem ao pipeline local/legado.

Prioridade para futuras migrations:

1. caminhos realmente usados pelo novo site/Edit;
2. joins de entidades/mentions/canon;
3. busca e paginação de transcrição;
4. jobs consultados operacionalmente.

Índices não utilizados não devem ser removidos apenas pelo advisor enquanto as features correspondentes ainda não entraram em uso.

Referência: https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

## Divergências e decisões

| Tema | Estado observado | Decisão TDA |
| --- | --- | --- |
| Produto | scope técnico legado `dnd-scribe` | `tda` é canônico; legado fica como alias temporário |
| Campanha | `yuhara-main` | manter |
| Proveniência | `craig`, `local_companion`, Discord/Roll20 | manter |
| PCs | `profile_characters`, sem entidade | vincular a `entities(type=pc)` |
| NPCs e outros objetos | `entities` preparado, vazio | usar a mesma registry canônica |
| Relations | roadmap/ideias históricas, sem schema aprovado | desenhar antes de migrar |
| `intent` | não encontrado | não criar até definição explícita |
| `item` | tipo de entity existente | manter |
| Canon consolidado | tabela pronta, vazia | alimentar somente via aprovação |
| RLS | predominantemente deny-by-default | revisar por superfície do Edit |

## Próximas auditorias

- validar a migration `align_tda_domain_identity`;
- revisar RPCs SECURITY DEFINER e grants antes de abrir o Edit;
- revisar índices com tráfego real após o novo site começar a consultar entidades;
- modelar relações/knowledge claims quando a feature entrar no roadmap executável;
- arquivar o scope `dnd-scribe` somente depois da independência do legado ser comprovada.
