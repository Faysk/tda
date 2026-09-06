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

## 10. Relações futuras

Quando implementado:

```text
entity A
  -> relation edge + type + direction + visibility + evidence/canon
  -> entity B
```

Não criar edges automaticamente apenas porque duas entities aparecem no mesmo segmento. Coocorrência pode ser evidência, não relação canônica.

## 11. Conhecimento/audience futuro

O modelo futuro deverá conseguir responder separadamente:

- o jogador sabe?
- o personagem sabe?
- o público da campanha sabe?
- é rumor?
- é mentira?
- é segredo do mestre?

`visibility` atual é base de audiência, mas não substitui um modelo completo de conhecimento.

## Failure boundaries

- falha de transcrição não invalida arquivo bruto/local;
- falha de classificação não deve duplicar candidatos em retry;
- falha de publicação não promove estado parcialmente;
- falha de R2 não remove metadata/origem sem confirmação;
- falha de companion não derruba leitura cloud já sincronizada;
- falta de identidade resolvida deixa vínculo pendente, não inventa personagem/profile.
