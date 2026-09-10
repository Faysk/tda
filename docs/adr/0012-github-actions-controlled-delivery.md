# ADR-0012 — GitHub Actions controla a entrega; Vercel Git auto-deploy permanece desligado

> Status: accepted
> Data: 2026-09-10
> Owner: operations / arquitetura / dados
> Relacionado: ADR-0002, docs/operations/ci-cd.md, docs/operations/environments.md, docs/operations/cicd-admin-setup.md

## Contexto

O TDA precisa publicar Preview e Production de forma rastreável, reproduzível e deliberada. O projeto Vercel canônico já existe, o domínio oficial `dnd.faysk.dev` está em uso e o Supabase canônico contém migration history anterior ao reboot TDA.

A integração Git nativa da Vercel é conveniente, mas criaria um segundo controlador de publicação. Isso conflita com os requisitos do reboot:

- CI precisa validar o SHA exato antes de qualquer deploy;
- Preview e Production possuem regras diferentes;
- Production precisa ser staged antes de receber tráfego;
- migrations precisam passar por dry-run, boundary gate e verificação de history;
- rollback de aplicação não pode tentar desfazer banco automaticamente;
- a origem de cada release precisa ser identificável por SHA/release id;
- push ou merge arbitrário não pode publicar Production por efeito colateral.

O Supabase adiciona um segundo problema estrutural: o migration history remoto possui migrations do legado que deliberadamente não pertencem ao repositório TDA. A primeira migration do reboot versionada no repo é `20260906210333_align_tda_domain_identity.sql`.

## Decisão

O **GitHub Actions é o único controlador da entrega do TDA**.

A integração Git da Vercel permanece sem publicação automática (`git.deploymentEnabled=false`). Workflows versionados no repositório constroem, publicam, validam e promovem artefatos.

O fluxo canônico é:

```text
feature/* | fix/* | refactor/* | ops/*
  -> PR para Preview
  -> CI + Companion
  -> Preview CD automático
  -> homologação
  -> PR Preview -> main
  -> Promotion Policy + CI + Companion
  -> Production CD
  -> prova de origem Preview -> main
  -> build Production
  -> deploy staged --skip-domain
  -> Supabase overlay + dry-run/apply/verify
  -> staged smoke
  -> vercel promote
  -> canonical smoke
  -> GitHub Release receipt
```

## Branches e autorização

### `Preview`

Representa o candidato homologável mais recente.

- recebe mudanças por PR no fluxo normal;
- CI roda no SHA exato;
- CI verde dispara Preview CD automaticamente;
- Preview CD recusa SHA stale ou arbitrário;
- o deployment carrega `APP_COMMIT_SHA` e `TDA_RELEASE_ID`;
- não aplica migrations em Production;
- não altera `dnd.faysk.dev`.

### `main`

Representa o estado aprovado para Production, mas **estar em `main` não basta para publicar**.

Production só aceita um SHA se ele for comprovadamente o resultado de uma PR mergeada:

```text
head = Preview
base = main
merge_commit_sha = SHA atual de main
```

Essa prova é feita pelo próprio `production.yml` consultando a API do GitHub antes de ler credenciais ou tocar Vercel/Supabase.

Consequência: push direto, merge direto ou PR de feature para `main` não consegue publicar Production, mesmo se branch protection estiver ausente.

## Promotion Policy

Toda PR cujo destino seja `main` deve vir de `Preview`. O workflow `.github/workflows/promotion-policy.yml` falha qualquer outra combinação.

Esse check é uma camada de governança antecipada; o provenance gate de Production é a camada fail-closed de runtime da esteira.

## GitHub Environments e credenciais

Os workflows usam GitHub Environments como boundary lógico de credenciais.

### `preview`

Secret mínimo:

- `VERCEL_TOKEN`.

### `production`

Secrets mínimos:

- `VERCEL_TOKEN`;
- `SUPABASE_ACCESS_TOKEN`;
- `SUPABASE_DB_PASSWORD`.

Valores secretos nunca são versionados, documentados ou impressos. IDs não secretos de team/projeto/ref ficam pinados no workflow para impedir execução contra contexto ambíguo.

## Preview automático

Depois de CI verde em `Preview`, o workflow:

1. fixa o HEAD de `Preview`;
2. recusa SHA stale/arbitrário;
3. exige `VERCEL_TOKEN`;
4. executa `vercel pull --environment=preview`;
5. constrói com `APP_ENV=preview` e `APP_COMMIT_SHA`;
6. publica deployment imutável;
7. valida `/api/health` e `/api/version` contra o SHA esperado;
8. valida `/` e `/sessoes`;
9. registra summary do deployment.

Falha de credencial, build ou smoke não afeta Production.

## Production staged antes de tráfego

Production nunca publica diretamente no domínio oficial.

Depois de provar a origem `Preview -> main`, o workflow:

1. valida credenciais;
2. valida migration policy;
3. constrói Production com SHA/release id;
4. publica com `--prod --skip-domain`;
5. executa os gates do Supabase;
6. faz smoke no deployment staged;
7. somente então executa `vercel promote`;
8. valida novamente `dnd.faysk.dev`.

Falha antes do promote mantém o domínio oficial na release anterior.

## Estratégia de migrations do Supabase

O repositório não copia migrations do legado apenas para satisfazer a CLI.

Boundary do reboot:

```text
20260906210333
```

Semântica:

```text
supabase/migrations/ = autorizado para Production
supabase/candidates/ = candidato ainda não autorizado
```

Production monta um **overlay efêmero** em workdir temporário:

1. `supabase init`;
2. `supabase link` no project ref canônico;
3. `supabase migration fetch` para materializar o history remoto apenas no overlay;
4. recusa migrations remotas TDA-era ausentes do repo;
5. sobrepõe as migrations TDA com os SQL autoritativos de `supabase/migrations`;
6. executa `db push --dry-run --skip-vault`;
7. aplica somente se o dry-run passar;
8. busca o history novamente;
9. exige igualdade exata desde o boundary;
10. executa advisors antes da troca de tráfego.

O overlay não usa `migration repair` e é descartado com o runner.

## Imutabilidade e provenance runtime

Cada release Production usa:

- source SHA exato;
- `APP_COMMIT_SHA`;
- `TDA_RELEASE_ID=prod-<short-sha>`;
- GitHub Release receipt após promoção e smoke canônico.

Preview usa `TDA_RELEASE_ID=preview-<short-sha>`.

`/api/health` e `/api/version` são superfícies obrigatórias de verificação. Um deployment que não prove o SHA esperado não é promovido.

## Rollback

Rollback de aplicação é manual e deliberado.

O workflow exige:

- target explícito;
- confirmação `ROLLBACK_TDA`;
- `VERCEL_TOKEN`;
- inspeção do candidate;
- leitura de `/api/version` antes da troca;
- verificação health/version depois da troca.

**Banco não sofre rollback automático.** Migrations devem preferir `expand -> migrate -> contract` para manter uma janela de compatibilidade com app rollback.

## Invariantes fail-closed

A entrega falha fechada quando:

- SHA solicitado não é o HEAD atual da branch fonte;
- Production source não é merge result de `Preview -> main`;
- credencial obrigatória está ausente;
- migration filename/policy viola contrato;
- existe migration TDA-era remota desconhecida;
- dry-run de banco falha;
- history pós-apply diverge do repo;
- staged smoke falha;
- canonical smoke falha;
- contexto Vercel/Supabase não corresponde ao canônico.

Nenhum desses casos pode ser convertido em warning apenas para “deixar passar”.

## Branch protection

Branch/ruleset protection continua recomendada:

- `Preview`: PR normal, CI obrigatório, sem force push/deletion;
- `main`: PR obrigatório, `promotion-source` e CI obrigatórios, sem force push/deletion.

Porém branch protection não é a única barreira de publicação. O provenance gate permanece obrigatório no próprio Production CD.

## Consequências

### Positivas

- um único controlador de entrega;
- Preview automaticamente homologável;
- Production exige proveniência verificável;
- push direto não publica;
- tráfego só muda depois de validações;
- migration history legado não precisa ser falsificado no Git;
- rollback app é independente e consciente do banco;
- release possui SHA e release id verificáveis.

### Custos

- GitHub Environments/secrets precisam ser administrados;
- Preview requer token Vercel em CI externo;
- Production requer credenciais Vercel + Supabase;
- workflow é mais longo que auto-deploy simples;
- versões pinadas de CLIs/actions exigem manutenção.

Os custos são aceitos porque reduzem publicação acidental, drift e ambiguity de provenance.

## Alternativas rejeitadas

### Vercel Git auto-deploy como controlador principal

Rejeitado porque pode publicar por push/merge antes dos gates de banco e promoção staged.

### Dois controladores em paralelo

Rejeitado porque GitHub Actions e Vercel Git poderiam publicar o mesmo SHA com regras diferentes.

### Repository variables como autorização final de Production

Foram úteis no bootstrap, mas rejeitadas como autorização permanente. Uma flag esquecida não prova origem de release. O contrato final usa provenance verificável `Preview -> main`.

### Copiar todo migration history legado para o repo

Rejeitado porque transformaria history remoto em autoria falsa do reboot.

### `migration repair` automático

Rejeitado porque pode mascarar drift real.

### Rollback automático de banco

Rejeitado porque DDL/data migrations não possuem inversão segura genérica.

## Evidência de bootstrap — 2026-09-10

- PR #129 integrou a fundação da esteira;
- CI e Companion passaram na `main`;
- Production CD foi observado `skipped` durante bootstrap;
- Vercel Git não criou deployment por merge;
- Supabase permaneceu sem alteração de migration history;
- `Preview` foi alinhada por fast-forward sem force;
- PR #142 ativou Preview CD automático;
- `Preview` no SHA `652710bca720d8f07c54aa2d73fb204d9d160c7c` passou CI e Companion;
- o primeiro Preview CD real executou e falhou **antes de qualquer deploy** no gate de `VERCEL_TOKEN`, provando que a esteira falha fechada quando a credencial externa não existe;
- Production canônica permaneceu saudável e sem troca causada por esse teste.

## Operação

Procedimentos completos estão em:

- [CI/CD — operação, promoção e recuperação](../operations/ci-cd.md);
- [Ambientes e configuração](../operations/environments.md);
- [Configuração administrativa do CI/CD](../operations/cicd-admin-setup.md).
