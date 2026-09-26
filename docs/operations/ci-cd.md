# CI/CD — operação, promoção e recuperação

> Status: vigente
> Owner: operations / release / dados
> Última revisão: 2026-09-20
> Fonte de verdade: workflows versionados + ADR-0015 + ADR-0018

## Objetivo

Este é o contrato operacional da entrega web do TDA.

Princípios:

- GitHub Actions é o controlador;
- `main` é a linha canônica de Production;
- Preview é deployment do SHA da PR;
- providers são substituíveis;
- gates pesados só participam quando necessários;
- trabalho remoto pendente não pode ser esquecido após falha;
- Production é staged antes de receber tráfego;
- rollback é mecanismo normal de recuperação.

## Fluxo

Os builds Whisper/Qwen e os fences de drift de Runtime RC/Stable incluem
`atomic_storage.py` e `attempt_fence.py` como dependências do worker. Alterar a
política de gravação ou de decisão de tentativa exige reconstruir o runtime; um
artefato antigo não pode ser promovido por apenas compartilhar versão nominal.
Isso amplia a verificação de fonte, sem disparar publicação nem retirar o hold.

### Hold operacional durante fechamento do backlog — 2026-09-26

Para cumprir o gate de escopo/revisão/validação antes da publicação, os workflows
`deploy-preview.yml`, `production.yml`, `companion-rc.yml`, `runtime-rc.yml`,
`companion-0315-production-validation-stable.yml`,
`companion-039-recovery-stable.yml` e
`qwen-1011-production-validation-stable.yml` foram desabilitados temporariamente
na configuração do GitHub Actions. CI e análise de segurança continuam ativas.
Esse hold evita que `workflow_run` publique uma entrega intermediária após CI.
Não altera o deployment ou os artefatos Stable já publicados.

O hold deve permanecer durante a integração do lote. Antes de liberar uma
publicação deliberada, conferir o SHA final, todos os gates e ausência de runs
antigos pendentes; reabilitar somente o workflow necessário e despachar o SHA
exato autorizado. A volta de qualquer cadeia automática requer decisão explícita
compatível com `AGENTS.md`; não reabilitar todos por conveniência. Registrar a
liberação e receipt neste documento/runbook de release. Estado atual do hold é
verificável pela API de workflows, sem consultar valores de secrets.

```text
branch temporária
      |
      v
    PR -> main
      |
      +--> workflow-contract
      +--> validate
      +--> DB somente se relevante
      +--> Companion somente se relevante
      +--> mídia somente se relevante
      +--> Preview do SHA exato
      +--> smoke
      |
      v
  required-ci
      |
      v
  merge main
      |
      v
 Production CD
      |
      +--> prova HEAD + PR mergeada
      +--> descobre SHA realmente publicado
      +--> migration pendente? lifecycle DB
      +--> mídia pendente? lifecycle Media Storage
      +--> build uma vez
      +--> stage sem tráfego
      +--> smoke
      +--> promote do mesmo artifact
      +--> canonical health/version
      +--> receipt
```

## Fonte e controle

GitHub é o control plane canônico.

Vercel é o provider atual de runtime/deploy; Vercel Git auto-deploy permanece desligado.

Supabase é o provider atual do PostgreSQL.

Cloudflare R2 é o provider atual do Media Storage.

A troca futura de provider não muda o ownership da esteira: GitHub Actions continua executando a operação até nova ADR.

## Pull requests

Toda PR executa o núcleo comum definido em `.github/workflows/ci.yml`.

Checks pesados são condicionais ao domínio alterado. Um job irrelevante pode ser `skipped`; um domínio relevante precisa terminar em sucesso para `required-ci`.

Preview:

- usa o SHA exato da PR;
- não é branch;
- não aplica migration em Production;
- não recebe credencial irrestrita de Production;
- precisa provar health/version e superfícies relevantes.

## Baseline real de Production

Antes de qualquer mutação remota, Production consulta:

`https://dnd.faysk.dev/api/version`

O commit retornado é o baseline publicado.

Ele precisa:

1. ser SHA válido conhecido pelo repo;
2. ser ancestral do novo HEAD;
3. representar o ponto a partir do qual trabalho remoto ainda pode estar pendente.

## Migrations

Migration remota é acumulativa.

```text
baseline Production -> novo main
          |
          +-> supabase/migrations/*.sql pendente?
```

Sem migration pendente:

- Supabase CLI não precisa participar;
- secrets de migration não são exigidos;
- deploy web não toca banco.

Com migration pendente, o lifecycle permanece fail-closed.

## Media Storage

Mídia e deploy web são ciclos relacionados, mas não equivalentes.

O deploy web comum **não** faz full audit global de todo o storage.

O lifecycle automático deve responder:

> existe manifest canônico no intervalo ainda não publicado?

```text
baseline Production -> novo main
          |
          +-> media/manifests/*.json pendente?
                |
                +-> publica/reusa
                +-> read-back
                +-> verifica entrega pública
                +-> receipt
```

A distinção importante é:

- objeto/manifest que já pertence a uma Production comprovada = histórico; não bloqueia release web futura;
- manifest depois do baseline cuja publicação falhou = **pendente**; não pode desaparecer só porque o merge seguinte não tocou mídia.

O publisher atual é:

`tools/ci/publish-production-media.sh`

e usa:

`tools/media/pipeline.mjs publish`.

### Secrets do publisher

Para o provider R2 atual, o GitHub Environment `production` é o boundary canônico:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

`R2_PUBLIC_BUCKET=tda-media-public` é configuração não secreta.

Não usar Vercel como cofre intermediário para uma operação executada pelo GitHub Actions.

### Implementação vigente

A esteira aplica o contrato acima diretamente:

- `production-release-plan.mjs` calcula `media_publish` a partir do intervalo completo ainda não publicado;
- `production.yml` passa o mesmo baseline range ao publisher;
- R2 credentials usados pelo publisher são lidos do GitHub Environment `production`;
- `vercel env run` não participa da autenticação do Media Storage;
- o publisher one-shot específico da Yllith foi removido; toda lore usa a pipeline compartilhada.

A presença administrativa dos três secrets não é inferida da documentação. Quando mídia está pendente, o gate `Validate only required release credentials` verifica os nomes esperados antes de build/stage; ausência falha cedo sem mover tráfego de Production.

## Staged deploy

O artefato de Production é construído uma vez com identidade explícita:

```text
APP_ENV=production
APP_COMMIT_SHA=<sha main>
TDA_RELEASE_ID=prod-<sha-curto>
```

Fluxo do provider atual:

```text
vercel build --prod
vercel deploy --prebuilt --prod --skip-domain
smoke
vercel promote <deployment>
```

O staged deployment não recebe tráfego do domínio oficial antes do smoke.

## Verificação canônica

Após promote:

- `health.ok=true`;
- `health.environment=production`;
- `health.commit=<SHA esperado>`;
- `version.commit=<SHA esperado>`;
- `version.release=<release esperado>`;
- raiz responde.

## Receipt

Uma release registra pelo menos:

- baseline anterior;
- SHA novo;
- PR de origem;
- release id;
- deployment staged/testado;
- canonical origin;
- migrations executadas ou skipped;
- Media Storage executado ou skipped;
- smoke staged/canonical.

Para mídia, `step success` não prova publicação. O receipt deve distinguir zero assets de publicação/reuso/verificação real.

## Secrets

### preview

```text
VERCEL_TOKEN
```

### production web

```text
VERCEL_TOKEN
```

### migration pendente

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

### Media Storage pendente — provider atual R2

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

Secrets condicionais só são exigidos quando seu lifecycle é necessário.

## Rollback

Rollback da aplicação:

```text
identificar deployment anterior saudável
 -> promover/rollback
 -> verificar canonical health/version
 -> corrigir em branch
 -> PR main
 -> nova Production
```

Banco e Media Storage não sofrem delete/rollback destrutivo automático.

## Evidência histórica

A migração para main-only e Production v3 está preservada em:

- [baseline da simplificação](cicd-simplification-baseline.md);
- [plano concluído](cicd-simplification-plan.md);
- [histórico de deployments](deployments.md).

Esses documentos explicam como chegamos aqui. Não substituem este runbook para comportamento atual.
