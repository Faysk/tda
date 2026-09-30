# Modelo de dados canônico

Este documento é o contrato vigente do reboot TDA. O repositório `Faysk/dnd-scribe` continua sendo fonte histórica, mas seus nomes, estados de conclusão e arquitetura não são importados automaticamente.

## Identidades canônicas

- Produto/projeto: `tda`.
- Registry de campanhas: `campaigns`; o sistema deve suportar N campanhas sem assumir uma única campanha vigente.
- Campanha histórica/compatível: `yuhara-main`; esse slug técnico permanece estável para consumidores legados e RBAC existentes.
- Segunda campanha registrada: `antes-que-seja-tarde`; o registro da campanha não implica criação automática de sessões, entities, memberships ou canon.
- Supabase existente: `dmrqnbdvbkfqzctcerbx`.
- `dnd-scribe` permanece temporariamente apenas como scope de compatibilidade do aplicativo legado enquanto ele estiver operacional.
- Valores de proveniência como `craig`, `local_companion`, `discord` e `roll20` descrevem a origem dos dados e não devem ser renomeados para `tda`.

### Identidade de Campaign

Campanha possui identidades com responsabilidades diferentes:

- `campaigns.id`: autoridade relacional estável. FKs e isolamento de dados devem usar o UUID da campanha;
- `campaigns.slug`: identidade técnica/compatibilidade. É usada por consumidores existentes, RBAC e integrações e não deve ser renomeada para alterar apresentação ou URL pública;
- `campaigns.public_slug`: identidade de rota/apresentação pública, evolutiva independentemente do slug técnico;
- `campaigns.name`: nome editorial humano;
- `campaigns.lifecycle_status`: lifecycle operacional do registro (`active | archived`).

`public_slug` **não é scope de autorização**. Código de autorização deve resolver a campanha e trabalhar com `campaign_id`/scope canônico ou com os helpers de compatibilidade explicitamente documentados. Uma rota pública mudar não pode mudar silenciosamente a identidade RBAC da campanha.

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
