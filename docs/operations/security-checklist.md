# Checklist de segurança operacional

> Status: vigente
> Owner: security/operations
> Última revisão: 2026-09-22

Use antes de abrir uma nova superfície, publicar release ou alterar integração sensível.

## Identidade e autorização

- [ ] usuário é autenticado no boundary correto;
- [ ] `auth_user` resolve para profile quando necessário;
- [ ] ação é validada por capability + scope no servidor/RPC;
- [ ] campaign/resource pertence ao scope permitido;
- [ ] UI não é o único controle de autorização;
- [ ] há testes negativos para usuário sem permissão.

## Dados

- [ ] payload retorna somente campos necessários;
- [ ] transcript/raw metadata não entram em endpoint público por acidente;
- [ ] conteúdo master/private possui audience explícita;
- [ ] outtake sensitive respeita consent/approval próprio;
- [ ] logs não despejam PII/transcript/secrets;
- [ ] novos JSONB não escondem relações/segredos sem contrato.

## Supabase

- [ ] migration versionada para DDL/grant/policy/function;
- [ ] RLS revisado;
- [ ] policy não é `true` ampla sem justificativa;
- [ ] `SECURITY DEFINER` valida auth/capability internamente;
- [ ] `EXECUTE` só para roles necessárias;
- [ ] query server-side não usa secret para bypass indiscriminado;
- [ ] advisors revisados quando mudança afeta DB.

## Secrets

- [ ] nenhum secret em Git/docs;
- [ ] nenhum secret em `NEXT_PUBLIC_*`;
- [ ] credencial tem escopo mínimo;
- [ ] Production e Preview não compartilham secret sem necessidade;
- [ ] bootstrap token temporário foi revogado;
- [ ] rotação está documentada quando necessária.

## R2/mídia

- [ ] bucket correto por environment/audience;
- [ ] public access deliberado;
- [ ] URL assinada só após authorization;
- [ ] MIME/origem/path validados;
- [ ] raw audio não foi enviado para cloud sem decisão de retenção;
- [ ] deleção não remove única fonte necessária para review.

## Vercel

- [ ] conta `projeto-desenv-6905` confirmada;
- [ ] environment correto;
- [ ] env vars corretas;
- [ ] auto-deploy continua conforme política;
- [ ] SHA conhecido;
- [ ] rollback conhecido;
- [ ] PR Preview privilegiado só recebe credencial de deploy em workflow confiável do default branch;
- [ ] código do PR não executa `pnpm install`, scripts ou build local no runner que possui `VERCEL_TOKEN`.

## GitHub / proteção de branch

- [ ] `main` está protegida e exige `required-ci`;
- [ ] merge normal ocorre por pull request;
- [ ] force-push e deleção estão bloqueados no estado administrativo efetivo;
- [ ] bypass/admin é reservado a recuperação explícita, com issue/incident, motivo, ator e restauração posterior;
- [ ] bypass nunca é usado para transformar CI vermelho em release aceitável;
- [ ] após recuperação administrativa, protection + `required-ci` são revalidados;
- [ ] quando a credencial não consegue ler settings administrativos, o item permanece não verificado em vez de ser inferido.

## Companion/API externa

- [ ] credencial técnica limitada;
- [ ] idempotency/retry definidos;
- [ ] input externo validado;
- [ ] protocol/schema version validado;
- [ ] key externa armazenada hashed quando aplicável;
- [ ] revogação/expiração possível;
- [ ] Actions de terceiros usam SHA imutável de 40 caracteres;
- [ ] CodeQL analisa TypeScript/JavaScript e Python em PR/main, com action pinada por SHA;
- [ ] RC distribuído possui attestation de provenance para os bytes publicados;
- [ ] MSI recebe Authenticode antes da criação do candidate manifest/RC quando o certificado de code signing estiver provisionado;
- [ ] assinatura nunca é aplicada depois do teste físico, pois isso alteraria os bytes aceitos.

## Canon e IA

- [ ] output de IA continua identificado como derivado;
- [ ] candidate não pula review;
- [ ] source/provenance preservada;
- [ ] confidence não é tratada como aprovação;
- [ ] reprocessamento não sobrescreve decisão humana;
- [ ] embedding/search não muda status canônico.

## Antes de tornar Edit público

Obrigatório resolver/inventariar:

- [x] RPCs `SECURITY DEFINER` inventariadas e classificadas em `docs/database/rpc-inventory.md`;
- [ ] grants finais dos helpers internos revisados após prova de consumidores;
- [ ] contrato multi-campaign de `access_directory` decidido e testado;
- [ ] capabilities de cada ação do Edit;
- [ ] audit trail dos writes críticos;
- [ ] dataset/strategy de Preview;
- [ ] policy de mídia privada;
- [ ] profile claim flow;
- [ ] tests de escalation/cross-campaign;
- [ ] secrets do companion/distribuição.

## Incidente

Se houver possível exposição de secret/dado:

1. revogar/rotacionar credencial;
2. conter acesso público;
3. preservar logs/evidência necessária;
4. identificar superfície/dados afetados;
5. corrigir root cause;
6. documentar decisão/guardrail novo;
7. só restaurar acesso após smoke negativo/positivo.

## Companion CodeQL triage — 2026-10-08 (#1625)

Scope: the baseline scan at `aba7f268e4357805c5f84e364e92934b5e247168` reported one public-error exposure and 38 benchmark path findings. PR #1606 replaces regex acceptance with static literal response values; the subsequent main scan no longer reports the error exposure. The 38 path findings require individual disposition after the exact delivery scan. No query suppression is added.

The Agent owns `data_root`; HTTP callers supply benchmark/profile identifiers, not an arbitrary storage root. `benchmark_root` rejects noncanonical identifiers, directory redirection and resolved-parent escape. `_profile_root` permits only the four profile identifiers and validates both directory boundaries. Bundle manifests and evidence descriptors require canonical fixed artifact paths and hashes. Reference revisions use an integer revision and a constrained generated filename; quality receipts additionally validate revision/digest and resolved parents at their own boundary.

Evidence: `test_security_benchmark_paths.py` exercises eight directory boundaries using Windows junctions or POSIX symlinks; `test_benchmark_bundles.py` rejects traversal, changed manifests and transcript mismatch; `test_benchmark_evidence.py` verifies export membership and artifact integrity; `test_benchmark_quality.py` exercises reference revision containment and invalid receipt identities; `test_api_security_headers.py` verifies static error values and security headers. Local Windows result: 86 passed, two older POSIX-only cases skipped; the new eight junction cases passed. Linux coverage and exact-head CI remain required.

Limits: these checks address remotely supplied identities and already redirected filesystem paths. They do not claim protection against a privileged local process racing filesystem replacement after validation. Closing a scan finding is a classification with the recorded boundaries, not removal of that limitation.

| Alert | Baseline sink | Validation boundary / disposition basis |
| --- | --- | --- |
| #52 | `benchmark_bundles.py:67` / `_is_reparse_point` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #53 | `benchmark_bundles.py:76` / `_is_reparse_point` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #54 | `benchmark_bundles.py:101` / `benchmark_root` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #55 | `benchmark_bundles.py:130` / `_profile_root` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #56 | `benchmark_bundles.py:136` / `_profile_root` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #57 | `benchmark_bundles.py:232` / `_bounded_bytes` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #58 | `benchmark_bundles.py:235` / `_bounded_bytes` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #59 | `benchmark_bundles.py:238` / `_bounded_bytes` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #60 | `benchmark_bundles.py:824` / `load_benchmark_bundle` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #62 | `benchmark_bundles.py:612` / `_benchmark_diagnostics_descriptor` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #63 | `benchmark_bundles.py:613` / `_benchmark_diagnostics_descriptor` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #64 | `benchmark_bundles.py:614` / `_benchmark_diagnostics_descriptor` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #65 | `benchmark_bundles.py:831` / `load_benchmark_bundle` | Canonical benchmark/profile roots; fixed artifacts, bounded reads and reparse rejection. |
| #66 | `benchmark_quality.py:275` / `_safe_reference_root` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #67 | `benchmark_quality.py:275` / `_safe_reference_root` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #68 | `benchmark_quality.py:277` / `_safe_reference_root` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #69 | `benchmark_quality.py:298` / `_safe_quality_root` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #70 | `benchmark_quality.py:298` / `_safe_quality_root` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #71 | `benchmark_quality.py:300` / `_safe_quality_root` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #72 | `benchmark_quality.py:311` / `_read_json` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #73 | `benchmark_quality.py:314` / `_read_json` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #74 | `benchmark_quality.py:317` / `_read_json` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #75 | `benchmark_quality.py:352` / `reference_index` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #78 | `benchmark_quality.py:649` / `save_reference_revision` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #79 | `benchmark_quality.py:652` / `save_reference_revision` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #80 | `benchmark_quality.py:682` / `save_reference_revision` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #81 | `benchmark_quality.py:1110` / `_quality_receipt_path` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #82 | `benchmark_quality.py:1111` / `_quality_receipt_path` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #83 | `benchmark_quality.py:1146` / `score_profile` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #84 | `benchmark_quality.py:1173` / `score_profile` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #85 | `benchmark_quality.py:1175` / `score_profile` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #86 | `benchmark_quality.py:1181` / `score_profile` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #87 | `benchmark_evidence.py:71` / `_read_bounded` | Validated bundle and canonical artifact descriptors before bounded reads; no caller-selected arbitrary path. |
| #88 | `benchmark_evidence.py:74` / `_read_bounded` | Validated bundle and canonical artifact descriptors before bounded reads; no caller-selected arbitrary path. |
| #89 | `benchmark_evidence.py:77` / `_read_bounded` | Validated bundle and canonical artifact descriptors before bounded reads; no caller-selected arbitrary path. |
| #90 | `benchmark_evidence.py:80` / `_read_bounded` | Validated bundle and canonical artifact descriptors before bounded reads; no caller-selected arbitrary path. |
| #91 | `benchmark_quality.py:287` / `_safe_reference_revisions_root` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |
| #92 | `benchmark_quality.py:289` / `_safe_reference_revisions_root` | Canonical benchmark root, contained reference/revision/quality directories and validated revision artifacts. |

The candidate version is 0.3.27. Stable remains 0.3.26 until the exact MSI has passed installed acceptance, all four physical profile gates and deliberate promotion. Source changes, scanner classification and release publication are separate states.

PR #1629 additionally reported #93–#95 on `_quality_receipt_path` at the
resolved-profile and artifact redirection checks. These are checks of a canonical
benchmark root plus an enumerated profile and a generated integer/hex filename;
revision type/range and SHA-256 fullmatch are validated before path composition.
Invalid identities and eight redirected directory boundaries are rejected by the
negative tests above. These three findings are reviewed sanitizer-model false
positives under the stated local-race limitation, not removed code or queries.
Full local Python acceptance: 1427 passed, 17 conditional skips, no failures.
