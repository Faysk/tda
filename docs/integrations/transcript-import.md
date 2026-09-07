# Importação de transcrição local

> Status: implementado em branch/PR; ativação negada
> Owner: sync/consumer + dados/Supabase
> Última revisão: 2026-09-07

## Contrato alinhado

Motorzinho confirmou o `publication_bundle_v1` do legado read-only. Ele contém identidade, resumo e hashes, mas **não contém segmentos**. A sincronização exige `import_artifacts` no envelope `tda_local_result_v1`, preservando o bundle original. Bundle isolado ou transcrição vazia são recusados.

O POST same-origin `/api/transcript-imports` recebe `{schemaVersion: "tda_transcript_import_v1", result: <envelope>}`. O envelope possui `campaign_id` e `session_id` UUID físicos existentes, `source_id`, `job_id`, `publication_bundle`, `import_artifacts` e `sync`. IDs opacos da fixture local `synthetic.fixture` não são IDs cloud.

`import_artifacts.publication_payload_json` e `transcript_json` são strings produzidas por Python `json.dumps(ensure_ascii=False, sort_keys=True, separators=(',', ':'))`. O SHA-256 usa os bytes UTF-8 exatos dessas strings. O primeiro exclui `publication_id` e `generated_at`, e deve corresponder semanticamente ao payload do bundle. O segundo é a timeline completa, cujo hash corresponde a `source_manifest.transcript_sha256`. Não reserializar floats no JavaScript: `1.0` do Python não tem a mesma representação textual que `1` do JavaScript.

As duas strings canônicas são verificadas no boundary da aplicação e preservadas sem reserialização até a RPC. O SQL recalcula os dois SHA-256 sobre os bytes UTF-8 exatos antes de aceitar a projeção. Depois dessa verificação, as strings não são persistidas no receipt nem no audit.

Limites: corpo de 2.000.000 bytes (medido no stream, sem confiar em Content-Length), 1–10.000 segmentos, texto até 10.000 caracteres, identidade/speaker/track até 160 caracteres, offsets até sete dias. Somente campos conhecidos; nenhum áudio, caminho absoluto, arquivo arbitrário, URL de download ou manifest local bruto. O hash do manifest permanece provenance declarada; o manifest privado não é transmitido nem reconstituído pelo servidor.

Timeline legada confirmada: `{id,speaker,track,start,end,text,words}`; `start/end` são `NUMBER` em **segundos**, inclusive fracionários, e `words` é **ARRAY** de `{word,start,end,probability}`. A projeção preserva todos os segmentos e seus textos, converte offsets para milissegundos, mantém IDs de origem, speaker e track basename. Words são validadas mas não persistidas nesta versão; `text_words` é derivado do texto projetado, não de `words.length`. Recap deve estar null e approved_entries/open_threads vazios neste corte de evidência; bundles editoriais são recusados, nunca publicados implicitamente. Não se alteram título, status, summary, canon nem vínculos de sessão.

## Autenticação e autorização

Auth/Catraca confirmou `getVerifiedServerIdentity()` (`getUser` no servidor) e Origin exatamente igual a `authConfig().origin`, sem fallback Host/forwarded headers. Token loopback do companion não entra no client de sync. Somente cookies same-origin do operador web.

Crachá confirmou a proposta `campaign.transcript.import`, plane `mixed`. A migration de catálogo apenas define a action; não cria `role_permissions` nem `role_assignments`, e falha fechado se uma action preexistente tiver plane incompatível. Scope: `campaign` com slug da campanha física, ou `project`/`tda` com a mesma action explicitamente presente. Login, usuário Windows, `local.process`, `upload.manage` e `project.jobs.run` não concedem importação.

A RPC religa `actor_profile_id` ao `auth_user_id`, exige assignment ativo/temporal e resolve campanha + scope como uma única condição antes de procurar ou bloquear a sessão. Campanha ausente ou fora do scope retorna `forbidden`; com campanha autorizada, target inexistente/incompatível retorna `not_found`. Target obrigatório: sessão UUID preexistente, campaign UUID exata, `source_system=local_companion` e `source_session_id=source_id`. Não cria sessão nem estabelece vínculo de origem.

## Persistência e recibo

Migration candidata `20260907193705_transcript_import_atomic` introduz `transcript_import_receipts` e RPC `import_transcript_bundle_atomic(auth_user_id, actor_profile_id, input jsonb, lookup_only boolean)`, `SECURITY INVOKER`, `service_role` somente, search_path fixo. A chave server-only continua no servidor. `PUBLIC`, `anon` e `authenticated` não recebem EXECUTE nem acesso direto ao receipt.

No commit, o SQL revalida envelope `tda_local_result_v1`, publication `publication_bundle_v1`, source interno, hashes internos, timeline não vazia, formato real dos segmentos/words e correspondência ordinal exata entre a timeline canônica em segundos e a projeção em milissegundos. UUID malformado é rejeitado como payload inválido antes de cast.

O lock da sessão serializa concorrência. Uma transação insere todos os segmentos com `pending`, `needs_review=true`, `revision=0`, o recibo e um audit sem texto privado. Recibo é imutável e único por sessão e por campanha/origem/sourceSessionId. Repetição coerente com os mesmos hashes/projeção retorna o recibo original sem segundo audit; payload internamente válido mas divergente retorna `conflict` sem sobrescrever revisão humana. Sessão já transcrita sem recibo é conflito, não adoção silenciosa. Falha em segmento, receipt ou audit desfaz tudo. As FKs do receipt para campaign/session usam `ON DELETE CASCADE`, alinhando retenção ao ownership físico já existente de transcript/audit.

`tda_transcript_receipt_v1`: status committed, receiptId UUID, campaignId/sessionId/sourceSystem/sourceSessionId, publicationId/transcriptSha256, segmentCount e committedAt. Não carrega transcript. O client somente marca synchronized após o POST de import e POST `/api/transcript-imports/receipt` retornarem o mesmo recibo confirmado e identidade/hash/count esperados. Resposta perdida mantém pending; retry reenvia o mesmo bundle e confirma por readback. O readback repete profile/capability/scope, portanto grant revogado, expirado ou foreign-scope não lê o receipt por esse endpoint. Erros estruturados: unauthenticated, forbidden, import_capability_undefined, invalid_payload, transcript_required (exportar os segmentos, bundle isolado não basta), unsupported_version, too_large, hash_mismatch, synthetic_payload, not_found, conflict, dependency_unavailable.

## Verificação reproduzível

`src/features/transcript-sync/fixtures/python-import.json` é inteiramente sintética, gerada com os módulos reais preservados de publication/artifacts do legado. Inclui acentos, emoji, floats integrais/fracionários, `words` como array e duas falas. `tools/transcript-sync-fixture.py <pasta app legada>` regenera sem ler gravações. O format `fixture.testdata` documenta somente teste; não há ingestão produtiva dessa fixture.

Testes unitários: `pnpm exec vitest run src/features/transcript-sync`. Ensaio PostgreSQL real: definir `TDA_SYNTHETIC_POSTGRES=1` e executar `pnpm exec vitest run src/features/transcript-sync/database.test.ts`. Linux precisa Python 3 e PostgreSQL 16 em `/usr/lib/postgresql/16/bin`; Windows usa WSL `Ubuntu-24.04`. O próprio teste inicia `tools/transcript-sync-db.py`, cria cluster scratch novo `/tmp/tda-sync-*`, socket 0700, sem TCP e sem variáveis PG herdadas, e o encerra ao final. Nenhum estado de outra tarefa é reutilizado.

O ensaio conecta client → handler HTTP → consumer → RPC real → PostgreSQL. **Auth está simulado por identidade fixa sintética no handler e authorize injetado**; a validação SQL de profile/grant/scope é real sobre fixture mínima. Não é prova de OAuth, PostgREST/Supabase real, schema completo, navegador ou companion transcrevendo. O teste SQL usa o mesmo RPC candidato e cobre rollback forçado de receipt/audit, tamper dos bytes canônicos, revogação/readback e duas conexões reais: payload idêntico resulta em um commit + replay; payload coerente porém divergente resulta em um commit + conflict, sempre com um único receipt/audit e somente os segmentos vencedores.

A PR SQL anterior #62 foi superseded e fechada sem merge. Suas migrations não devem ser integradas nem aplicadas; apenas a ideia de rehash UTF-8 foi incorporada nesta candidata única.

## Ativação e rollback

1. Reconciliar a candidata única com a `main` vigente e exigir CI terminal do SHA exato, incluindo PostgreSQL scratch.
2. Ensaio UI + serviço scratch + bundle não vazio + consumer persistente + receipt/readback, incluindo perda pós-commit. Auth sintética deve continuar identificada; prova OAuth real é gate separado.
3. Aplicação deliberadamente autorizada das migrations pelo [runbook do banco](../operations/database-runbook.md), verificação remota de history/RLS/EXECUTE/advisors. Nenhuma aplicação foi executada nesta entrega.
4. Grant deliberado da action para operador/scope autorizado; não há grant automático no código. Target de origem precisa preexistir. Definir adapter real de export não sintético.
5. Troca revisada de `server.ts` de `deniedImportDependencies` para `databaseImportDependencies` e ensaio operacional de autenticação/recibo. O gate atual é literal e não possui override env/unsafe. Só então habilitar a UI de sync.
6. Rollback funcional: restaurar o gate negado e desabilitar UI; preservar segmentos e recibos para retry/auditoria. Não deletar evidência nem retirar action usada por outra role sem análise. Não há rollback destrutivo automático. Remoção de objetos somente em migration posterior revisada com consumidores e retenção mapeados.

Nenhum deploy, DDL/importação em produção, ASR, GPU, custo ou grant de operador faz parte desta execução.
