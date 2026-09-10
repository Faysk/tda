# ADR-0012 — GitHub Actions controla a entrega; Vercel Git auto-deploy permanece desligado

> Status: accepted
> Data: 2026-09-10
> Owner: operations / arquitetura / dados
> Relacionado: ADR-0002, docs/operations/ci-cd.md, docs/operations/release-runbook.md

## Contexto

O TDA precisa publicar Preview e Production de forma rastreável, reproduzível e deliberada. O projeto Vercel canônico já existe e o domínio oficial `dnd.faysk.dev` está em uso, enquanto o Supabase canônico contém migration history anterior ao reboot TDA.

A integração Git nativa da Vercel é conveniente, mas cria um segundo controlador de publicação. Isso conflita com os requisitos do reboot:

- CI precisa validar o SHA exato antes de qualquer deploy;
- Preview e Production possuem regras diferentes;
- Production precisa ser staged antes de receber tráfego;
- migrations precisam passar por dry-run, boundary gate e verificação de history;
- rollback de aplicação não pode tentar desfazer banco automaticamente;
- a origem de cada release precisa ser identificável por SHA/release id;
- simplesmente fazer merge não pode publicar por efeito colateral.

O Supabase adiciona um segundo problema estrutural: o migration history remoto possui migrations do legado que deliberadamente não pertencem ao repositório TDA. A primeira migration do reboot versionada no repo é `20260906210333_align_tda_domain_identity.sql`.

## Decisão

O **GitHub Actions é o único controlador da entrega do TDA**.

A integração Git da Vercel permanece com publicação automática desligada (`git.deploymentEnabled=false`). Workflows versionados no repositório são responsáveis por construir, publicar, validar e promover artefatos.

O fluxo canônico após bootstrap é:

```text
feature/*
  -> PR para Preview
  -> CI
  -> Preview CD
  -> homologação
  -> PR Preview -> main
  -> CI
  -> Production staged
  -> Supabase overlay + gates
  -> smoke do artefato staged
  -> vercel promote
  -> smoke canônico
  -> receipt da release
```

## Branches e responsabilidades

### `Preview`

Representa o candidato homologável mais recente.

- recebe mudanças por PR no fluxo normal;
- CI roda no SHA exato da branch;
- Preview CD só executa quando os gates de ativação estiverem armados;
- não aplica migrations em Production;
- não muda o domínio canônico.

### `main`

Representa o estado aprovado para Production.

- depois do bootstrap, a origem normal é `Preview -> main`;
- CI precisa passar no SHA exato da `main`;
- Production CD cria primeiro um deployment staged sem trocar tráfego;
- o domínio oficial só muda após banco + smoke positivos.

## Gates de ativação

Dois níveis de gate impedem publicação acidental.

Trava mestra:

```text
TDA_CICD_BOOTSTRAP_READY=true
```

Switches específicos:

```text
TDA_PREVIEW_CD_ENABLED=true
TDA_PRODUCTION_CD_ENABLED=true
```

Preview exige simultaneamente a trava mestra e o switch de Preview. Production exige simultaneamente a trava mestra e o switch de Production.

A política de promoção possui gate separado:

```text
TDA_ENFORCE_PROMOTION_SOURCE=true
```

Quando ativo, PR para `main` que não venha de `Preview` falha no check `promotion-source`.

## GitHub Environments

Os workflows usam GitHub Environments como boundary de credenciais.

### `preview`

Secret esperado:

- `VERCEL_TOKEN`.

### `production`

Secrets esperados:

- `VERCEL_TOKEN`;
- `SUPABASE_ACCESS_TOKEN`;
- `SUPABASE_DB_PASSWORD`.

Valores secretos nunca são versionados. IDs não secretos de projeto/team/ref podem ficar pinados no workflow para impedir execução contra contexto ambíguo.

## Production staged antes de tráfego

Production não publica diretamente no domínio oficial.

O workflow:

1. resolve o HEAD atual de `main`;
2. recusa SHA stale/arbitrário;
3. constrói o artefato Production;
4. publica com `--skip-domain`;
5. executa gates do Supabase;
6. faz smoke no deployment staged;
7. somente então executa `vercel promote`;
8. valida novamente o domínio canônico.

Falha antes do promote mantém `dnd.faysk.dev` apontando para a release anterior.

## Estratégia de migrations do Supabase

O repositório não copia migrations do legado apenas para satisfazer a CLI.

O boundary do reboot é:

```text
20260906210333
```

Production monta um **overlay efêmero** em workdir temporário:

1. inicializa um projeto Supabase descartável;
2. faz `link` no project ref canônico;
3. executa `migration fetch` para materializar o history remoto apenas nesse overlay;
4. recusa entradas remotas a partir do boundary que não existam em `supabase/migrations`;
5. sobrepõe as migrations TDA com os SQL autoritativos do repo;
6. executa `db push --dry-run --skip-vault`;
7. executa o apply somente se o dry-run passar;
8. busca o history remoto novamente;
9. exige igualdade exata entre o conjunto TDA remoto e `supabase/migrations`;
10. roda advisors antes da promoção de tráfego.

O overlay não usa `migration repair` e é descartado com o runner.

## Imutabilidade e provenance

Cada release Production usa:

- source SHA exato;
- `APP_COMMIT_SHA`;
- `TDA_RELEASE_ID=prod-<short-sha>`;
- receipt no GitHub Release após promoção e smoke canônico.

`/api/health` e `/api/version` são superfícies de verificação runtime. Releases antigas podem não expor os campos/endpoints novos; isso não autoriza inferir SHA sem evidência de deployment/build.

## Rollback

Rollback de aplicação é manual e deliberado.

O workflow de rollback:

- exige target explícito;
- exige confirmação `ROLLBACK_TDA`;
- inspeciona o candidate antes de trocar tráfego;
- valida `/api/version` do candidate;
- executa rollback de tráfego;
- verifica health/version no domínio canônico.

**Banco não sofre rollback automático.** Se uma migration não for backward-compatible, recuperação exige estratégia corretiva específica.

## Invariantes fail-closed

A entrega deve falhar fechada quando:

- SHA solicitado não é o HEAD atual da branch fonte;
- credencial obrigatória está ausente;
- migration filename/policy viola contrato;
- existe migration TDA-era remota desconhecida;
- dry-run de banco falha;
- history pós-apply diverge do repo;
- staged smoke falha;
- canonical smoke falha;
- contexto Vercel/Supabase não corresponde ao canônico.

Nenhum desses casos deve ser convertido em warning para “deixar passar”.

## Consequências

### Positivas

- existe um único controlador de entrega;
- merge não equivale a deploy;
- Preview e Production têm gates explícitos;
- tráfego só muda depois de validações;
- migration history legado não precisa ser falsificado no Git;
- rollback app é independente e consciente do banco;
- cada release possui provenance verificável.

### Custos

- GitHub Environments, secrets e repository variables precisam ser administrados;
- ativação inicial exige sequência de bootstrap;
- o workflow é mais longo que auto-deploy simples;
- manutenção das versões pinadas de CLI/actions passa a ser responsabilidade operacional.

Esses custos são aceitos porque reduzem risco de publicação acidental e drift operacional.

## Alternativas rejeitadas

### Vercel Git auto-deploy como controlador principal

Rejeitado porque cria deploy por merge/push antes dos gates de banco e promoção staged.

### Dois controladores em paralelo

Rejeitado porque GitHub Actions e Vercel Git poderiam publicar o mesmo SHA em momentos/regras diferentes.

### Copiar todo migration history legado para o repo

Rejeitado porque transformaria history remoto em autoria falsa do reboot e aumentaria risco de alterações acidentais em SQL histórico.

### `migration repair` automático

Rejeitado porque altera metadata de migration history como parte de um deploy normal e pode mascarar drift real.

### Rollback automático de banco

Rejeitado porque DDL/data migrations não possuem inversão segura genérica.

## Estado de bootstrap observado em 2026-09-10

A infraestrutura desta decisão foi integrada inicialmente pela PR #129.

Evidências observadas:

- PR #129 integrada à `main` por squash;
- CI e Companion da `main` passaram no commit de integração;
- Production CD foi disparado por `workflow_run` e terminou `skipped` enquanto os gates de ativação estavam desarmados;
- Vercel não criou deployment Git automático após o merge;
- Production canônica permaneceu no deployment anterior;
- migration history do Supabase permaneceu inalterado;
- `Preview` foi posteriormente avançada por fast-forward sem force para o HEAD então atual da `main`, confirmando que a branch antiga era ancestral direto.

A ativação dos Environments/secrets/variables é uma operação administrativa separada. A existência dos workflows não significa que Production esteja habilitada.

## Operação

Procedimentos, sequência de ativação, testes e recuperação estão em [CI/CD — operação, bootstrap e gates](../operations/ci-cd.md).
