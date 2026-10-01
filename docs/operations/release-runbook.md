# Release, deploy e rollback

> Status: vigente
> Owner: operations / release
> Última revisão: 2026-09-28
> Fonte de verdade: CI/CD, environments e providers atuais

Este runbook é genérico. Checklists de uma feature específica pertencem ao documento da feature ou ao histórico da release, não aqui.

## 1. Antes da PR

Confirmar:

- escopo fechado;
- risco e rollback conhecidos;
- documentação do contrato atualizada;
- migration identificada quando existir;
- manifests de mídia identificados quando existirem;
- nenhum secret em código/docs;
- testes locais relevantes passam.

Deploy não é ferramenta de desenvolvimento.

## 2. Pull request

Fluxo:

```text
branch temporária -> PR main
```

Exigir o SHA exato da PR nos checks.

A CI decide quais domínios pesados participam, mas `required-ci` continua sendo o contrato estável para merge.

## 3. Preview

Preview é deployment Vercel da PR, não branch.

Validar:

- health/version;
- rota/superfície alterada;
- desktop/mobile quando visual;
- auth/permissões quando relevantes;
- nenhuma dependência acidental de Production;
- canonical/share URL não aponta para `*.vercel.app`.

Preview aprovado não significa Production publicada.

## 4. Merge

Com `required-ci` verde, mergear em `main`.

`main` é código aceito para Production, mas mutações remotas ainda precisam concluir.

## 5. Production CD

Acompanhar o lifecycle completo:

1. prova de HEAD + PR mergeada;
2. baseline realmente publicado;
3. migration pendente;
4. Media Storage pendente;
5. build;
6. staged deploy sem tráfego;
7. smoke;
8. promote do mesmo artifact;
9. canonical verification;
10. receipt.

Falha antes do promote não deve mover o domínio oficial.


### Exceção versionada de validação em Production — #628

Para a recuperação do Qwen em #628, o proprietário autorizou explicitamente usar
Production como ambiente do teste físico final porque o caminho Qwen Stable vigente
já falha no Craig longo observado. A exceção é limitada a **Companion 0.3.16** e
**Qwen Runtime 1.0.12**.

O fluxo continua fail-closed:

1. CI/package do source SHA exato;
2. RC imutável e verificação dos assets;
3. promoção do **mesmo objeto/mesmos bytes**, sem rebuild;
4. receipt machine-readable registrando que o aceite físico pré-promoção foi
   deliberadamente substituído por validação em Production;
5. rollback preservado em Companion 0.3.15 / Qwen 1.0.11;
6. #628 permanece aberta até o Craig longo na RTX 4070 concluir com os bytes exatos.

Os bridges são one-shot/version-locked e ignoram versões futuras. Se `main` avançar,
a promoção só continua quando não houver drift nos inputs que alteram os bytes ou o
contrato do componente. Esta exceção não muda a política normal RC → aceite físico →
Stable das demais releases.

### Whisper Runtime 1.1.7 / Benchmark — #1233

Para o reparo do contrato de benchmark do Whisper:

1. `1.1.5` é histórico imutável. Não sobrescrever tag, release ou archive, mesmo que exista build posterior com o mesmo número.
2. O candidato corrigido deve usar versão nova (`1.1.7` neste ciclo), source SHA e archive SHA exatos.
3. O workflow de build precisa passar o smoke do comando de benchmark empacotado; rejeição de protocolo/exit 64 é bloqueante.
4. Publicar RC não implica Stable. Executar aceite físico do **mesmo archive** no Windows/GPU suportado.
5. O aceite final deve executar a mesma amostra local de 5 minutos nos quatro perfis e preservar receipts/lineage com runtime worker hash, runtime version e GPU observada, sem publicar áudio/transcrição privada.
6. Só depois do receipt físico correspondente o workflow governado de promoção pode reutilizar os mesmos bytes como Stable.
7. Migration deve preservar modelos, caches, jobs/runs e dados locais. O runtime `1.1.5` pode continuar servindo transcrição normal enquanto benchmark permanece bloqueado.
8. Rollback volta deliberadamente ao último artefato aceito; benchmark fica fail-closed se o runtime anterior não satisfizer o contrato. Uma correção posterior recebe nova versão, nunca rebuild do `1.1.5`.

### Whisper Runtime 1.1.8 / contenção palavra-segmento — #1235

A correção de contenção altera o adapter/worker empacotado e portanto exige uma identidade de runtime nova. O Runtime 1.1.6 de #1234 e o Runtime 1.1.7 de #1233 já foram materializados oficialmente e permanecem imutáveis; o candidato que contém #1235 é **Whisper Runtime 1.1.8**.

1. Não rebuildar, retaggear nem sobrescrever 1.1.6 ou 1.1.7 com os bytes da #1235.
2. O archive 1.1.8 precisa incorporar a fronteira de decode compatível de #1234 e os smokes sintéticos vigentes.
3. Antes de promoção, executar `local-companion/packaging/run-whisper-craig-containment-acceptance.ps1` contra o Craig staged autorizado e o `TDARuntime-candidate.json` do **mesmo RC 1.1.8**.
4. O gate físico executa `whisper-turbo` e `whisper-detailed`, cada um com sample Craig de exatamente 300 s e transcrição integral.
5. O full precisa produzir `run.json` e `transcript.json`; o SHA do transcript deve corresponder ao manifesto e ambos os arquivos são re-hashados ao final para provar imutabilidade.
6. O receipt compartilhável `whisper-1235-acceptance.json` registra somente identidade/hashes do runtime, GPU/driver e métricas agregadas. Não registrar áudio, transcript, speaker, source id ou caminhos locais.
7. Qualquer falha de contenção, duração, ordering, dedup, turns ou integridade aborta a promoção. O contrato `tda_transcript_v1` continua estrito; não clipar/remover palavras nem reescrever run concluído para fazê-lo passar.
8. Rollback seleciona um runtime Whisper anterior já publicado e compatível, preservando Models/Data/runs. Correção posterior recebe nova versão imutável.

## 6. Secrets e providers

Antes de operação remota, confirmar o boundary correto:

### Runtime/deploy atual — Vercel

- team/project canônicos;
- `VERCEL_TOKEN` no GitHub Environment apropriado;
- runtime envs presentes quando necessários.

### Banco atual — PostgreSQL/Supabase

Quando migration pendente:

- `SUPABASE_ACCESS_TOKEN`;
- `SUPABASE_DB_PASSWORD`;
- project ref correto;
- migration history compatível.

### Media Storage atual — R2

Quando publicação pendente:

- `R2_ACCOUNT_ID`;
- `R2_ACCESS_KEY_ID`;
- `R2_SECRET_ACCESS_KEY`;
- bucket/origin esperados.

Secrets operacionais do GitHub Actions pertencem ao GitHub Environment. Não usar Vercel como cofre indireto de R2.

## 7. Mídia

Toda mídia persistida/publicada pertence ao Media Storage.

Antes de marcar mídia como publicada:

- manifest/identidade corretos;
- SHA-256/MIME/bytes verificados;
- objeto publicado ou reutilizado sem overwrite silencioso;
- read-back;
- GET público quando audience pública;
- consumer real testado;
- receipt com quantidade real de assets.

`step success` com zero assets não prova publicação.

Manifest em `main` também não prova publicação.

## 8. Banco

Migration:

- versionada no Git;
- validada;
- aplicada pelo lifecycle autorizado;
- verificada remotamente;
- compatível com rollback do app quando necessário.

Não usar `supabase db push` manual para destravar Production.

## 9. Smoke de Production

Depois do promote:

- `/api/health`;
- `/api/version`;
- SHA/release;
- raiz;
- rotas alteradas;
- auth quando alterada;
- imagens/media URLs consumidas pela superfície;
- canonical e metadata quando aplicáveis.

Navegação normal deve permanecer em `dnd.faysk.dev`; aliases de provider são diagnóstico.

## 10. Receipt

Registrar:

- PR;
- source SHA;
- baseline anterior;
- release id;
- deployment;
- migrations: executadas/skipped;
- Media Storage: assets/reused/published/verified ou skipped;
- smoke;
- canonical verification;
- rollback conhecido.

Histórico detalhado: [deployments](deployments.md).

## 11. Rollback

### Aplicação

Promover/rollback para deployment anterior saudável, confirmar health/version e corrigir via nova PR.

### Banco

Não existe rollback automático destrutivo. Avaliar compatibilidade e migration corretiva/reversão explicitamente desenhada.

### Media Storage

Restaurar referência anterior quando necessário. Objetos imutáveis podem permanecer para cache/auditoria/rollback. Não apagar objeto como primeira resposta.

## 12. Abortar quando

- CI do SHA exato está vermelha;
- provider/contexto é incerto;
- secret/config necessária não está confirmada;
- migration drift não está explicado;
- mídia pública não passou integridade/read-back/entrega;
- conteúdo privado aparece em payload público;
- staged smoke diverge da identidade esperada;
- documentação vigente contradiz o comportamento que está sendo promovido.

## Drift atual de Media Storage

Em 2026-09-20 a publicação automática de mídia ainda precisa convergir para ADR-0018: secrets R2 devem vir do GitHub Environment e publicação pendente deve ser acumulativa desde o baseline.

Enquanto esse drift existir, não usar bypass manual para concluir release com mídia nova.
