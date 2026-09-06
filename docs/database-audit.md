# Auditoria do banco de produção

Revisão: 2026-09-06. Projeto Supabase: `dmrqnbdvbkfqzctcerbx`.

Este documento registra fatos observados no banco. Não transforma automaticamente documentação histórica do `dnd-scribe` em requisito do reboot.

## Estado resumido

O schema público tem RLS habilitado em todas as tabelas observadas. A maior parte das tabelas operacionais não possui policies e, portanto, permanece fechada para acesso direto por roles comuns; o site atual usa uma fronteira server-side controlada para conteúdo publicado.

Dados relevantes observados antes do alinhamento:

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
- entities: 0
- entity mentions: 0
- canon entries: 0

Após as migrations do reboot em 2026-09-06:

- `entities`: 3, todos PCs (`Astel`, `Dandelion`, `Screacky`)
- `profile_characters` ligados a entity: 3/3
- participações históricas desses PCs ligadas a entity: 12/12
- `project / tda`: 2 assignments técnicos ativos
- `project / dnd-scribe`: 2 assignments técnicos ativos preservados para o legado
- `entity_mentions` e `canon_entries`: continuam vazios; nenhuma memória/canon foi inventada pela migration

## O que já está implementado no schema

### Mundo narrativo
`entities` aceita `pc`, `npc`, `location`, `item`, `organization`, `faction`, `arc`, `concept`, `song`, `quest` e `other`. Há suporte de audiência/visibilidade e ligação de `canon_entries` e `entity_mentions`. O reboot adicionou aliases à registry e unicidade de slug por campanha para preparar resolução/navegação.

### Canon e revisão
O banco possui o pipeline `segment_classifications` → candidatos → `review_decisions` → `canon_entries`/`publications`. `canon_candidates` mantém fontes de segmento/Roll20 e IDs de entidades relacionadas.

### Pessoas e personagens
`profiles` representa pessoas/contas. `profile_characters` associa essas pessoas a entidades PC. `participants` representa uma aparição por sessão e pode apontar diretamente para a entidade do personagem mesmo quando o registro histórico não possui `profile_id`.

Os registros antigos de Astel, Dandelion e Screacky tinham apenas uma das quatro participações de cada PC vinculada a profile. A migration preservou essa lacuna humana e recuperou somente a identidade narrativa: 4/4 participações de cada PC agora apontam para a entity correta.

Há uma inconsistência histórica de grafia a revisar: o banco usa `Screacky`, enquanto material legado contém referências a `Screaky`. Nenhuma grafia foi alterada nem adicionada como alias automaticamente.

### Autorização
Há dois modelos coexistindo:

1. `campaign_members.role`, usado por RPCs legadas;
2. RBAC extensível com `permission_catalog`, `role_definitions`, `role_permissions` e `role_assignments`.

O reboot deve convergir para capabilities derivadas do RBAC sem quebrar as RPCs legadas durante a transição.

Scopes observados antes do alinhamento:

- `campaign / yuhara-main`: 18 assignments
- `project / dnd-scribe`: 2 assignments técnicos

Estado pós-migration:

- `campaign / yuhara-main` permanece inalterado;
- `project / tda` possui os mesmos 2 assignments técnicos necessários ao reboot;
- `project / dnd-scribe` foi preservado porque a API legada ainda possui `PROJECT_SCOPE_ID='dnd-scribe'` hardcoded.

O scope antigo só pode ser encerrado depois da independência do legado.

## Migrations do reboot aplicadas

- `20260906210333_align_tda_domain_identity`
- `20260906210427_backfill_narrative_entity_links`

Os arquivos correspondentes ficam em `supabase/migrations` no repositório TDA.

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

As migrations do reboot já cobrem os caminhos narrativos que passarão a ser usados por entities/mentions/canon: lookup de entities por campanha/tipo/status/nome/slug/aliases, foreign keys de `entity_mentions`, `profile_characters.profile_id` e busca GIN de `canon_candidates.related_entity_ids`.

Prioridade restante para futuras migrations:

1. caminhos realmente usados pelo novo Edit;
2. busca e paginação de transcrição;
3. jobs consultados operacionalmente;
4. foreign keys restantes comprovadamente quentes.

Índices não utilizados não devem ser removidos apenas pelo advisor enquanto as features correspondentes ainda não entraram em uso.

Referência: https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

## Divergências e decisões

| Tema | Estado observado | Decisão TDA |
| --- | --- | --- |
| Produto | scope técnico legado `dnd-scribe` | `tda` canônico + alias legado temporário |
| Campanha | `yuhara-main` | manter |
| Proveniência | `craig`, `local_companion`, Discord/Roll20 | manter |
| PCs | `profile_characters` separado de entities | vinculado a `entities(type=pc)` |
| NPCs e outros objetos | registry pronta | usar a mesma `entities` |
| Participantes históricos | profile incompleto | preservar profile; recuperar apenas entity por nome/campanha |
| Relations | roadmap/ideias históricas, sem schema aprovado | desenhar antes de migrar |
| `intent` | não encontrado | não criar até definição explícita |
| `item` | tipo de entity existente | manter |
| Canon consolidado | tabela pronta, vazia | alimentar somente via aprovação |
| RLS | predominantemente deny-by-default | revisar por superfície do Edit |

## Próximas auditorias

- finalizar auth/capabilities do reboot usando scope `tda`;
- revisar RPCs SECURITY DEFINER e grants antes de abrir o Edit;
- revisar índices com tráfego real após o novo site começar a consultar entidades;
- modelar relações/knowledge claims quando a feature entrar no roadmap executável;
- decidir a grafia canônica `Screacky` vs `Screaky` e registrar a outra como alias se apropriado;
- arquivar o scope `dnd-scribe` somente depois da independência do legado ser comprovada.
