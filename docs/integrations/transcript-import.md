# Importação de transcrição local

> Status: implementado em branch/PR; ativação negada
> Owner: sync/consumer; SQL pendente de revisão dados/Supabase
> Última revisão: 2026-09-07

## Contrato alinhado

Motorzinho confirmou o `publication_bundle_v1` do legado read-only. Ele contém identidade, resumo e hashes, mas **não contém segmentos**. A sincronização exige `import_artifacts` no envelope `tda_local_result_v1`, preservando o bundle original. Bundle isolado ou transcrição vazia são recusados.

O POST same-origin `/api/transcript-imports` recebe `{schemaVersion: "tda_transcript_import_v1", result: <envelope>}`. O envelope possui `campaign_id` e `session_id` UUID físicos existentes, `source_id`, `job_id`, `publication_bundle`, `import_artifacts` e `sync`. IDs opacos da fixture local `synthetic.fixture` não são IDs cloud.

`import_artifacts.publication_payload_json` e `transcript_json` são strings produzidas por Python `json.dumps(ensure_ascii=False, sort_keys=True, separators=(',', ':'))`. O SHA-256 usa os bytes UTF-8 exatos dessas strings. O primeiro exclui `publication_id` e `generated_at`, e deve corresponder semanticamente ao payload do bundle. O segundo é a timeline completa, cujo hash corresponde a `source_manifest.transcript_sha256`. Não reserializar floats no JavaScript: `1.0` do Python não tem a mesma representação textual que `1` do JavaScript.

Limites: corpo de 2.000.000 bytes (medido no stream, sem confiar em Content-Length), 1–10.000 segmentos, texto até 10.000 caracteres, identidade/speaker/track até 160 caracteres, offsets até sete dias. Somente campos conhecidos; nenhum áudio, caminho absoluto, arquivo arbitrário, URL de download ou manifest local bruto. Strings canônicas são verificadas e descartadas após a projeção. O hash do manifest permanece provenance declarada; o manifest privado não é transmitido nem reconstituído pelo servidor.

Timeline legada: `{id,speaker,track,start,end,text,words}`; start/end em segundos, words `{word,start,end,probability}`. A projeção preserva todos os segmentos e seus textos, offsets em milissegundos, IDs de origem, speaker e track basename. Words são validadas mas não persistidas nesta versão. Recap deve estar null e approved_entries/open_threads vazios neste corte de evidência; bundles editoriais são recusados, nunca publicados implicitamente. Não se alteram título, status, summary, canon nem vínculos de sessão.

## Autenticação e autorização

Auth/Catraca confirmou `getVerifiedServerIdentity()` (`getUser` no servidor) e Origin exatamente igual a `authConfig().origin`, sem fallback Host/forwarded headers. Token loopback do companion não entra no client de sync. Somente cookies same-origin do operador web.

Crachá confirmou a proposta `campaign.transcript.import`, plane `mixed`. A migration de catálogo apenas define a action; não cria role_permissions nem role_assignments. Scope: `campaign` com slug derivado de `sessions.campaign_id -> campaigns.slug`, ou `project`/`tda` com a mesma action explicitamente presente. Login, usuário Windows, local.process, upload.manage e project.jobs.run não concedem importação.

Target obrigatório: sessão UUID preexistente, campaign UUID exata, `source_system=local_companion` e `source_session_id=source_id`. Não cria sessão nem estabelece vínculo de origem. A consulta física de colunas em 2026-09-07 confirmou os campos usados; SQL candidato ainda requer revisão Cofrinho e auditoria dos grants/constraints na ativação.

## Persistência e recibo

Migration candidata `20260907193705_transcript_import_atomic` introduz `transcript_import_receipts` e RPC `import_transcript_bundle_atomic(auth_user_id, actor_profile_id, input jsonb, lookup_only boolean)`, SECURITY INVOKER, service_role somente, search_path fixo. A chave server-only continua no servidor. Auth user/profile são conferidos novamente no SQL, assim como action física, grant ativo/temporal, scope e source ownership.

O lock da sessão serializa concorrência. Uma transação insere todos os segmentos com pending/needs_review, o recibo e audit sem texto privado. Recibo único por sessão e campanha/origem/sourceSessionId. Repetição com mesmos hashes retorna o recibo original; conflito de hashes ou projeção retorna conflict sem sobrescrever revisão humana. Sessão já transcrita sem recibo é conflito, não adoção silenciosa. Falha em segmento, recibo ou audit desfaz tudo.

`tda_transcript_receipt_v1`: status committed, receiptId UUID, campaignId/sessionId/sourceSystem/sourceSessionId, publicationId/transcriptSha256, segmentCount e committedAt. Não carrega transcript. O client somente marca synchronized após o POST de import e POST `/api/transcript-imports/receipt` retornarem o mesmo recibo confirmado e identidade/hash/count esperados. Resposta perdida mantém pending; retry reenvia o mesmo bundle e confirma por readback. Erros estruturados: unauthenticated, forbidden, import_capability_undefined, invalid_payload, transcript_required (exportar os segmentos, bundle isolado não basta), unsupported_version, too_large, hash_mismatch, synthetic_payload, not_found, conflict, dependency_unavailable.

## Verificação reproduzível

`src/features/transcript-sync/fixtures/python-import.json` é inteiramente sintética, gerada com os módulos reais preservados de publication/artifacts do legado. Inclui acentos, emoji, floats integrais/fracionários e duas falas. `tools/transcript-sync-fixture.py <pasta app legada>` regenera sem ler gravações. O format `fixture.testdata` documenta somente teste; não há ingestão produtiva dessa fixture.

Testes unitários: `pnpm exec vitest run src/features/transcript-sync`. Ensaio PostgreSQL real: definir `TDA_SYNTHETIC_POSTGRES=1` e executar `pnpm exec vitest run src/features/transcript-sync/database.test.ts`. Linux precisa Python 3 e PostgreSQL 16 em `/usr/lib/postgresql/16/bin`; Windows usa WSL `Ubuntu-24.04`. O próprio teste inicia `tools/transcript-sync-db.py`, cria cluster scratch novo `/tmp/tda-sync-*`, socket 0700, sem TCP e sem variáveis PG herdadas, e o encerra ao final. Nenhum estado de outra tarefa é reutilizado.

O ensaio conecta client → handler HTTP → consumer → RPC real → PostgreSQL. **Auth está simulado por identidade fixa sintética no handler e authorize injetado**; a validação SQL de profile/grant/scope é real sobre fixture mínima. Não é prova de OAuth, PostgREST/Supabase real, schema completo, navegador ou companion transcrevendo. O teste SQL usa o mesmo RPC candidato, em conexões independentes. UI integrada pertence ao próximo marco com Painelzinho; endpoint mock isolado não prova sync.

## Ativação e rollback

1. Revisão Cofrinho do SQL, schema/grants/constraints reais e revisão da action por Crachá; reconcile main e CI terminal do SHA exato.
2. Ensaio UI + serviço scratch + bundle não vazio + consumer persistente + receipt/readback, incluindo perda pós-commit. Auth sintética deve continuar identificada; prova OAuth real é gate separado.
3. Aplicação deliberadamente autorizada das migrations pelo [runbook do banco](../operations/database-runbook.md), verificação remota de history/RLS/EXECUTE/advisors. Nenhuma aplicação foi executada nesta entrega.
4. Grant deliberado da action para operador/scope autorizado; não há grant automático no código. Target de origem precisa preexistir. Definir adapter real de export não sintético.
5. Troca revisada de `server.ts` de `deniedImportDependencies` para `databaseImportDependencies` e ensaio operacional de autenticação/recibo. O gate atual é literal e não possui override env/unsafe. Só então habilitar a UI de sync.
6. Rollback funcional: restaurar o gate negado e desabilitar UI; preservar segmentos e recibos para retry/auditoria. Não deletar evidência nem retirar action usada por outra role sem análise. Não há rollback destrutivo automático. Remoção de objetos somente em migration posterior revisada com consumidores e retenção mapeados.

Nenhum deploy, DDL/importação em produção, ASR, GPU, custo ou grant de operador faz parte desta execução.
