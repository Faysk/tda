# Fluxos ponta a ponta

> Status: vigente/parcialmente preparado
> Owner: arquitetura + domínios
> Última revisão: 2026-09-06

Este documento descreve **movimento de dados e mudança de autoridade**. Para detalhes físicos de tabela, ver [catálogo de schema](../database/schema-catalog.md).

## 1. Leitura pública de sessões

```text
browser
  -> Next.js server
  -> consulta estreita Supabase
  -> filtra campaign=yuhara-main + status/visibilidade publicados
  -> model de domínio
  -> renderer seguro
  -> HTML/stream para browser
```

Regras:

- segredo Supabase permanece server-side;
- catálogo não busca transcrição completa nem dados de usuários;
- mídia aceita somente origens explicitamente permitidas;
- resumo Markdown é renderizado sem HTML bruto arbitrário;
- nenhuma ausência de secret deve ser mascarada com dado fake.

## 2. Captura e ingestão de sessão

Direção vigente:

```text
Craig/Discord/arquivos locais
  -> companion local
  -> inventário/manifest
  -> participants + recording metadata + jobs
  -> chunks/speech slices locais quando necessário
  -> transcrição/classificação
  -> resultados e metadados sincronizados ao Supabase
```

Princípios:

- áudio bruto não precisa permanecer em cloud;
- trabalho deve ser retomável e idempotente;
- `source_system`, hashes e IDs externos preservam provenance;
- arquivos intermediários não definem canon.

## 3. Transcrição

```text
recording_file
  -> audio_chunk / audio_speech_slice
  -> provedor/modelo de transcrição
  -> transcription_cache
  -> transcript_segments
  -> revisão/correção quando necessário
```

Rastreabilidade esperada:

- arquivo/chunk de origem;
- offsets `start_ms`/`end_ms`;
- speaker/participant quando resolvido;
- provider/model/prompt_version/run quando aplicável;
- custo/uso em `ai_usage_ledger`.

Transcrição é **evidência textual derivada**, não fato canônico.

## 4. Classificação e candidatos

```text
transcript_segment
  -> segment_classification
  -> canon_candidate | quote_candidate | outtake_candidate
  -> fila de revisão
```

IA pode sugerir categoria, relevância e candidato. Ela não pode aprovar canon por conta própria.

## 5. Revisão e canon

```text
fonte
  -> candidato
  -> revisão humana
  -> review_decision
  -> canon_entry / publication
```

Regra de autoridade:

```text
raw evidence < derived classification < candidate < approved canon/publication
```

Um estágio posterior não apaga a fonte anterior. Canon aprovado deve continuar rastreável.

## 6. Entity resolution

```text
nome/alias em fonte ou candidato
  -> resolução controlada
  -> entities.id
  -> entity_mentions / canon_entries / participant.character_entity_id
```

- `entities.id`/slug são a direção de identidade canônica;
- nomes e aliases são resolução/apresentação;
- PC e NPC usam a mesma registry;
- `profile` continua pessoa/conta, não personagem.

## 7. Publicação

```text
conteúdo revisado
  -> publication(draft)
  -> aprovação
  -> publication(published + visibility)
  -> leitura pública/privada conforme audiência
```

Publicar não é simplesmente alterar frontend. É mudança de estado de conteúdo e deve respeitar audience, aprovação e fontes.

## 8. Mídia

```text
arquivo aprovado
  -> R2 bucket adequado
  -> metadata/relação no banco
  -> URL pública controlada ou URL assinada/autorizada
  -> consumidor
```

Buckets/credenciais não são modelo de autorização do domínio. A aplicação decide se o usuário pode solicitar/receber acesso.

## 9. Auth e capabilities

Direção:

```text
OAuth/Auth
  -> auth.users
  -> profiles.auth_user_id
  -> role_assignments + role_permissions
  -> capability check por scope
  -> ação/autorização
```

`campaign_members.role` continua legado compatível para RPCs existentes. Nova UI não deve embutir regras do tipo `if role === 'master'` quando o comportamento pode ser expresso por capability.

## 10. Relations first-class

Quando o schema for aprovado:

```text
evidence
  -> canon_candidate(type=relation)
  -> revisão
  -> canon_entry
  -> entity_relation + source(s)
```

A relation conecta entities canônicas e carrega semântica, direção/simetria, lifecycle e visibility.

Não criar edges automaticamente apenas porque duas entities aparecem no mesmo segmento. Coocorrência pode sustentar sugestão de revisão, não relação canônica.

Contrato proposto: [relations-data-contract.md](../features/relations-data-contract.md).

## 11. World Explorer / graph projection

O World Explorer não entrega rows cruas para React Flow.

Fluxo:

```text
browser request
  + identity/session/audience
  + focus entity
  + filters/depth
        ↓
Next.js server / feature case
        ↓
resolve focus entity
        ↓
query entities + relations autorizadas
        ↓
authorization/visibility filter
        ↓
projection DTO mínima
  nodes[] + edges[]
        ↓
React Flow client canvas
        ↓
selection / focus / inspector
```

### Regra de segurança

Filtrar **antes** da serialização.

Não fazer:

```text
server -> envia relation secreta -> CSS/React esconde
```

A existência do edge pode revelar o segredo.

### Projection

A projection contém apenas apresentação necessária:

- IDs opacos/UUID;
- label;
- tipo;
- imagem autorizada;
- route;
- relation label/type/family;
- direção.

Não precisa carregar source transcript, reviewer notes, metadata integral ou confidence interna.

### Interação

Trocar foco pode disparar nova projection server-aware. Estado visual local (pan/zoom/selection) não altera canon nem relation.

### Fixtures

O primeiro vertical slice usa fixtures onde necessário. Fixture é fonte de UI/teste, não evidence/canon e nunca é persistida como relation real por conveniência.

## 12. Perfil editorial de entity

```text
route tipada (/personagens/... etc.)
  -> resolve entity por slug/type
  -> aplica visibility/audience
  -> compõe entity + canon + relations + moments + media autorizada
  -> server-rendered profile
```

O inspector do World Explorer consome um subconjunto desse mesmo domínio; não deve duplicar uma segunda identidade da entity.

## 13. Conhecimento/audience futuro

O modelo futuro deverá conseguir responder separadamente:

- o jogador sabe?
- o personagem sabe?
- o público da campanha sabe?
- é rumor?
- é mentira?
- é segredo do mestre?

Fluxo conceitual:

```text
claim/canon/rumor
  -> knowledge assertion por knower/perspectiva
  -> authorization da audience do produto
  -> projection específica da perspectiva
```

`visibility` atual é base de audiência, mas não substitui um modelo completo de conhecimento.

## 14. Design System

```text
Design System v1.0 + Brand Pack
  -> tokens/primitives oficiais no reboot
  -> components/features
  -> light/dark/system
  -> UI validada por a11y/responsividade
```

O Design System não altera authority do conteúdo. Um estado visual nunca promove candidate para canon.

## Failure boundaries

- falha de transcrição não invalida arquivo bruto/local;
- falha de classificação não deve duplicar candidatos em retry;
- falha de publicação não promove estado parcialmente;
- falha de R2 não remove metadata/origem sem confirmação;
- falha de companion não derruba leitura cloud já sincronizada;
- falta de identidade resolvida deixa vínculo pendente, não inventa personagem/profile;
- falha do World Explorer não impede perfil/lista textual de relações quando disponível;
- erro de layout React Flow não altera/persiste domain data;
- filtro de UI não substitui authorization server-side;
- asset visual ausente usa fallback, não remove entity/relation.