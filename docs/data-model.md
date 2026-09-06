# Modelo de dados canônico

Este documento é o contrato vigente do reboot TDA. O repositório `Faysk/dnd-scribe` continua sendo fonte histórica, mas seus nomes, estados de conclusão e arquitetura não são importados automaticamente.

## Identidades canônicas

- Produto/projeto: `tda`.
- Campanha principal: `yuhara-main`.
- Supabase existente: `dmrqnbdvbkfqzctcerbx`.
- `dnd-scribe` permanece temporariamente apenas como scope de compatibilidade do aplicativo legado enquanto ele estiver operacional.
- Valores de proveniência como `craig`, `local_companion`, `discord` e `roll20` descrevem a origem dos dados e não devem ser renomeados para `tda`.

## Vocabulário

### Profile
`profiles` representa uma pessoa/conta do sistema. Pode estar vinculada a `auth.users`. Não representa um personagem do mundo.

### Campaign member e RBAC
`campaign_members` é o membership histórico simples da campanha e ainda alimenta RPCs legadas. O modelo de autorização extensível usa `permission_catalog`, `role_definitions`, `role_permissions` e `role_assignments`.

A UI do reboot deve consumir capabilities/permissões, nunca depender diretamente de nomes de roles.

### Entity
`entities` é o registro canônico dos objetos narrativos/mundo. Tipos atualmente aceitos:

- `pc`
- `npc`
- `location`
- `item`
- `organization`
- `faction`
- `arc`
- `concept`
- `song`
- `quest`
- `other`

PC e NPC pertencem, portanto, ao mesmo universo de entidades. O que muda é o tipo e os vínculos, não a existência de tabelas paralelas de personagem.

### Profile character
`profile_characters` associa uma pessoa (`profile`) a um personagem jogável (`entity` do tipo `pc`). Mantém informações de vínculo como aliases, aprovação e notas do jogador. Durante a transição o nome textual continua existindo para compatibilidade.

### Participant
`participants` representa a participação em uma sessão específica. É ocorrência operacional, não identidade canônica. Quando possível aponta para a entidade do personagem representado naquela sessão.

### Transcript segment
`transcript_segments` é evidência bruta/derivada de uma sessão. Texto transcrito não é canon por si só.

### Entity mention
`entity_mentions` liga uma entidade a evidências onde ela foi mencionada: sessão, segmento ou evento Roll20. Uma menção não afirma que o conteúdo é verdadeiro/canônico.

### Canon candidate
`canon_candidates` é uma afirmação proposta pela IA ou por revisão humana, sempre com fontes. Estados como `interpretation`, `possible_hook` e `retcon_pending` não devem ser tratados como fato aprovado.

### Canon entry
`canon_entries` é a memória consolidada. Só deve ser produzida a partir de decisão aprovada e mantém referência ao candidato/fonte. Pode estar associada a uma entidade e possui status para supersession/retcon/arquivamento.

## Pipeline conceitual

```text
sessão/áudio/eventos
        ↓
transcript_segments / roll20_events / session_markers
        ↓
segment_classifications
        ↓
canon_candidates / quote_candidates / outtake_candidates
        ↓ revisão humana
review_decisions
        ↓
canon_entries + entities + publications
```

Regra: **fonte → candidato → revisão → memória/publicação**. Nada deve pular diretamente de transcrição para canon.

## Domínios do banco atual

### Identidade e acesso
- `profiles`
- `campaigns`
- `campaign_members`
- `profile_characters`
- `profile_claims`
- `permission_catalog`
- `role_definitions`
- `role_permissions`
- `role_assignments`
- `dm_tenures`
- `ordo_access_members`

### Sessões e evidências
- `sessions`
- `participants`
- `recording_files`
- `transcript_segments`
- `roll20_events`
- `session_markers`
- `table_notes`
- `discord_interactions`
- `historical_documents`

### Revisão e memória narrativa
- `segment_classifications`
- `canon_candidates`
- `quote_candidates`
- `outtake_candidates`
- `review_decisions`
- `entities`
- `entity_mentions`
- `canon_entries`
- `publications`
- `audit_log`

### Processamento local/cloud metadata
- `processing_jobs`
- `processing_job_steps`
- `transcription_cache`
- `ai_usage_ledger`
- `craig_manifests`
- `craig_track_extraction_steps`

### Artefatos de áudio
- `audio_chunks`
- `audio_speech_slices`
- `audio_artifacts`
- `audio_artifact_events`
- `audio_retention_policies`

Essas tabelas registram pipeline e retenção. O reboot não deve reativar retenção cloud de áudio bruto.

### Integração externa
- `external_api_clients`
- `external_api_keys`

## Features futuras já sustentadas pelo modelo

### Personagens e NPCs
A base canônica é `entities`. PCs recebem vínculo com `profile_characters`; NPCs não precisam de profile humano. Ambos podem receber mentions, canon e relações futuras.

### Lugares, itens, facções, organizações, arcos, conceitos, músicas e quests
Já são tipos previstos em `entities`. Não criar tabelas independentes apenas para distinguir o tipo sem necessidade de dados estruturados específicos.

### Relações / grafo
O roadmap prevê relações e possível visualização com React Flow. Relações devem ser first-class edges entre entidades, com direção quando aplicável, visibilidade, estado e evidência/canon. O schema definitivo de relações ainda **não está aprovado**; não criar JSON solto em `entities.metadata` nem uma tabela prematura antes de fechar a semântica.

Exemplos históricos que a modelagem deverá comportar: aliança, dívida, traição, família, segredo, conhecimento e conflito.

### Conhecimento e audiência
O histórico prevê separar conhecimento do jogador, personagem, público, rumor, mentira e segredo do mestre. Os campos de `visibility` existentes são uma base de audiência, mas um modelo de knowledge claims ainda precisa ser desenhado quando essa feature entrar no roadmap executável.

### Busca semântica
A busca futura deve indexar conteúdo derivado com referências às fontes e entidades. Embedding não altera o status canônico do conteúdo.

### Intents
Não foi encontrado um conceito canônico chamado `intent`/`intents` no schema atual nem na documentação histórica revisada. `item` é um tipo de entidade documentado e existente. Se `intent` representar outra feature, ela precisa de definição própria antes de virar tabela/coluna.

## Regras de evolução

1. Preferir migrations pequenas e reversíveis.
2. Nunca apagar proveniência histórica para “renomear o produto”.
3. Não duplicar identidade narrativa entre tabelas.
4. JSONB é extensão, não substituto de relações estruturais importantes.
5. Todo dado sensível precisa de audiência/permissão explícita antes de chegar ao browser.
6. RLS sem policy pode ser deliberadamente fechado; não adicionar policies genéricas só para eliminar lint.
7. `SECURITY DEFINER` exposto deve ter autorização interna revisada e grants explícitos.
8. Canon exige fonte e revisão humana.
9. Features futuras entram primeiro neste contrato e só depois no schema.
