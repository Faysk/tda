# Ambientes e configuração

> Status: vigente
> Owner: operations
> Última revisão: 2026-09-10

Este documento define os ambientes do TDA, seus limites de dados/segredos e o relacionamento com a esteira. Procedimentos de entrega estão em [CI/CD — operação, promoção e recuperação](ci-cd.md); configuração administrativa está em [CI/CD — configuração administrativa](cicd-admin-setup.md).

## Ambientes conceituais

Há três ambientes lógicos, mas apenas dois targets cloud de publicação.

| Ambiente | Fonte | Publicação | Dados |
| --- | --- | --- | --- |
| Development | branches temporárias | nenhuma | local/sintético/configurado deliberadamente |
| Preview / homologação | `Preview` | Vercel Preview automática após CI verde | sem migration automática em Production; R2 Preview |
| Production | `main` proveniente de `Preview -> main` | Vercel staged → gates → promote para `dnd.faysk.dev` | Supabase Production + R2 Production |

Não existe necessidade de um terceiro projeto Vercel apenas para Development.

## Development

Objetivo: desenvolver e testar sem publicar.

Regras:

- `.env.local` não é versionado;
- build/test local deve ser reproduzível a partir do repo;
- integração externa só é usada quando configurada deliberadamente;
- mock não deve ser confundido com Production;
- branches `feat/*`, `fix/*`, `refactor/*`, `ops/*` são temporárias e normalmente seguem para PR em `Preview`.

`TDA_EDIT_UNSAFE=true` continua sendo flag transitória de desenvolvimento quando aplicável. Ela não é mecanismo de CI/CD e nunca deve ser usada como atalho para guards de Production.

## Preview / homologação

Objetivo: validar o candidato real antes de Production.

Fonte canônica:

```text
Preview
```

Comportamento final:

- CI verde em `Preview` dispara Preview CD automaticamente;
- o workflow fixa o HEAD exato e recusa SHA stale/arbitrário;
- o deployment recebe `APP_ENV=preview`;
- `APP_COMMIT_SHA` recebe o SHA real;
- `TDA_RELEASE_ID=preview-<12-char-sha>`;
- `/api/health` e `/api/version` precisam provar o SHA;
- `/` e `/sessoes` precisam responder;
- nenhuma migration é aplicada no Supabase Production;
- `dnd.faysk.dev` nunca é alterado por Preview.

### Credencial de Preview

GitHub Environment esperado:

```text
preview
```

Secret mínimo:

```text
VERCEL_TOKEN
```

O primeiro Preview CD real em 2026-09-10 provou que esse secret ainda não estava disponível ao job: o workflow falhou no gate de credential **antes de qualquer deploy**.

### Dados de Preview

Preview não deve receber credencial irrestrita de Production apenas por conveniência.

- R2 Preview: `tda-media-preview`;
- leitura de dados publicados de Production só deve ocorrer quando deliberadamente autorizada e segura;
- escrita administrativa em Production a partir de Preview não é o padrão;
- migrations são validadas em CI, mas aplicadas somente por Production CD;
- quando houver necessidade real de dados isolados completos, usar projeto/branch Supabase dedicado conforme plano/custo disponível.

## Production

Objetivo: servir o TDA aprovado no domínio oficial.

Fonte canônica:

```text
main
```

Porém `main` isoladamente não autoriza publicação. O SHA precisa ser comprovadamente resultado de:

```text
Preview -> main
```

O `production.yml` verifica pela API do GitHub que o SHA atual é o `merge_commit_sha` de uma PR mergeada com `head=Preview` e `base=main`.

Push direto ou PR de outra branch para `main` não pode alcançar Vercel/Supabase no Production CD.

### Recursos canônicos

Supabase:

```text
dmrqnbdvbkfqzctcerbx
```

Vercel team:

```text
team_9wuTfarCQ3L63xtufPKUDzi0
```

Vercel project:

```text
prj_hDiDvvRiesg3qCDekGWE8JQMkIyH
```

Domínio:

```text
https://dnd.faysk.dev
```

R2 Production:

```text
tda-media-public
tda-media-private
```

### Credenciais de Production

GitHub Environment esperado:

```text
production
```

Secrets mínimos:

```text
VERCEL_TOKEN
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

Esses secrets controlam deployment/migration. Runtime secrets da aplicação continuam configurados na Vercel por ambiente.

## Runtime e versões

Node é fixado pelo `.node-version`; package manager pelo `package.json`. CLIs usadas na entrega são pinadas nos workflows.

Alteração de runtime/CLI deve passar por CI e revisão do runbook quando mudar comportamento de deployment/migration.

## Variáveis de runtime

### Public client config

Somente valores seguros para browser. `NEXT_PUBLIC_*` significa publicação deliberada.

### Server secrets

Supabase secret/service credentials, R2 credentials, OAuth secrets e semelhantes. Nunca entram no bundle do browser.

### Feature/config

Flags e endpoints não secretos, mas ainda específicos de ambiente.

Exemplos atuais:

- `TDA_READ_PUBLISHED_DATA`;
- `TDA_READ_EDIT_DATA`;
- `TDA_EDIT_UNSAFE`;
- `TDA_AUTH_ORIGIN`;
- `APP_ENV`;
- `APP_COMMIT_SHA`;
- `TDA_RELEASE_ID`.

## Variáveis antigas de bootstrap da esteira

As seguintes flags foram úteis durante a montagem inicial, mas não fazem parte da autorização final:

```text
TDA_CICD_BOOTSTRAP_READY
TDA_PREVIEW_CD_ENABLED
TDA_PRODUCTION_CD_ENABLED
TDA_ENFORCE_PROMOTION_SOURCE
```

O contrato final usa comportamento automático em Preview e provenance verificável para Production. Se essas repository variables ainda existirem, podem ser removidas depois da confirmação administrativa.

## Supabase por ambiente

### Production

Usa o projeto existente. O migration history remoto contém legado anterior ao reboot TDA.

Boundary do TDA:

```text
20260906210333
```

Semântica do Git:

```text
supabase/migrations/ = autorizado para Production
supabase/candidates/ = candidato ainda não autorizado
```

Production cria overlay efêmero, faz `migration fetch`, recusa drift TDA-era, executa dry-run, aplica somente o necessário e busca o history novamente antes de qualquer promote.

Não existe `migration repair` automático.

### Preview

Não executa `db push` no projeto Production. Testes de banco acontecem em PostgreSQL scratch/sintético no CI.

## R2 por ambiente

- Production public/private separados por audience;
- Preview usa bucket próprio;
- local pode usar filesystem/mock explícito ou integração configurada;
- rollback do app não implica apagar/reverter objetos R2.

## Vercel

A integração Git automática permanece desligada. GitHub Actions é o controlador.

### Preview

```text
vercel pull --environment=preview
vercel build
vercel deploy --prebuilt
```

### Production

```text
vercel pull --environment=production
vercel build --prod
vercel deploy --prebuilt --prod --skip-domain
```

O candidate staged só recebe tráfego depois de migration gates + smoke:

```text
vercel promote <deployment>
```

O mesmo artefato testado é o artefato promovido.

## Health e provenance

### Preview

Obrigatório:

```text
health.ok = true
health.environment = preview
health.commit = source sha
version.commit = source sha
version.release = preview-<shortsha>
```

### Production

Obrigatório antes e depois do promote:

```text
health.ok = true
health.environment = production
health.commit = source sha
version.commit = source sha
version.release = prod-<shortsha>
```

A Production observada antes da primeira release pela nova esteira ainda respondeu `commit=null`/`release=null`; isso identifica a necessidade de uma release rastreável, não autoriza inventar provenance retroativa.

## Regras de secret

- não versionar `.env.local`;
- não colocar valores em docs/PR/issues;
- não expor em client bundle;
- não imprimir em logs;
- preferir menor escopo possível;
- rotacionar em caso de suspeita;
- validar Preview após rotação antes de liberar Production.

## Branches e proteção administrativa

Fluxo esperado:

```text
branch temporária -> PR -> Preview -> PR -> main
```

Branch protection/rulesets recomendados:

- PR obrigatório;
- CI obrigatório;
- `promotion-source` obrigatório em `main`;
- bloquear force push/deletion.

No snapshot observado em 2026-09-10, `main`/`Preview` ainda apareciam sem protection e não havia rulesets. A conexão usada nesta automação não possui permissão administrativa para alterar essa superfície.

Production continua fail-closed pelo provenance gate mesmo sem essa proteção, mas a proteção deve ser configurada para governança completa.

## Estado operacional observado em 2026-09-10

- fundação CI/CD integrada pela PR #129;
- ADR/runbooks integrados pela PR #136;
- `Preview` alinhada por fast-forward sem force;
- CI/Companion de `Preview` verdes;
- PR #142 ativou Preview CD automático;
- SHA de ativação: `652710bca720d8f07c54aa2d73fb204d9d160c7c`;
- primeiro Preview CD real falhou somente por `VERCEL_TOKEN` ausente, antes de deploy;
- Production não foi alterada;
- runtime errors observados na Production: nenhum no intervalo consultado;
- Production atual ainda não prova SHA/release via runtime metadata.

## Checklist de novo ambiente

1. finalidade definida;
2. branch/source definida;
3. data boundary definido;
4. storage boundary definido;
5. secrets mínimos criados;
6. nenhum Production secret desnecessário;
7. runtime vars coerentes;
8. smoke positivo e negativo;
9. observability ativa;
10. rollback/teardown definidos;
11. documentação atualizada.
