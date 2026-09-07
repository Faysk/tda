# Runbook — release, deploy e rollback

> Status: vigente
> Owner: operations/release
> Última revisão: 2026-09-07

## Objetivo

Publicar o TDA de maneira deliberada e recuperável. **Merge não significa deploy.**

## Pré-condições

- escopo da release fechado;
- PR revisada;
- SHA candidato conhecido;
- migrations reconciliadas;
- documentação atualizada;
- conta/ambiente corretos identificados;
- rollback pensado.

## 1. Validar código

Executar o contrato do repo:

```text
pnpm install --frozen-lockfile
pnpm docs:generate
pnpm check
pnpm build
pnpm test:e2e
```

`pnpm docs:generate` atualiza o catálogo documental gerado; não duplicar inventários manuais que pertençam a `docs/documentation/catalog.md`. O conteúdo canônico deve ser alterado no documento dono e o catálogo apenas regenerado.

A CI deve ficar verde. Falha não é ignorada por "só ser docs/UI" se o check canônico inclui a área. Antes de integrar um recorte de release, aguardar CI terminal do **SHA exato** que será integrado.

## 2. Validar banco

Se a release depende de schema:

- migration está aplicada/planejada na ordem correta;
- history remoto corresponde ao repo;
- constraints/FKs/indexes esperados existem;
- nenhum backfill ficou pela metade;
- RLS/grants/RPCs foram revisados;
- código anterior ainda é compatível se rollback for necessário.

## 3. Validar dados e audience

- conteúdo público está realmente aprovado;
- queries não transportam transcript/private metadata;
- master/player/public visibility testadas;
- outtakes/sensitive não vazam por associação;
- assets apontam para origens permitidas.

## 4. Validar frontend

Desktop e mobile:

- home;
- catálogo/lista de sessions;
- session detail/summary;
- navegação pública canônica preserva `https://dnd.faysk.dev` e não troca para alias `*.vercel.app`;
- URLs de compartilhamento/canonical usam o domínio oficial;
- navegação/URLs legadas;
- estados loading/empty/error;
- Markdown;
- imagens;
- acessibilidade básica;
- auth quando fizer parte da release.

A navegação pública canônica acima é contrato introduzido pela PR #31 e deve ser revalidada em toda release que tocar shell público, links, metadata, share ou routing.

## 5. Verificar Vercel

**Obrigatório antes de write:**

- account/context: `projeto-desenv-6905`;
- email associado informado: `projeto_desenv@outlook.com`;
- team: `projeto-desenv-6905s-projects` (`team_9wuTfarCQ3L63xtufPKUDzi0`);
- project: `tda` (`prj_hDiDvvRiesg3qCDekGWE8JQMkIyH`);
- environment: Production/Preview deliberado;
- nenhuma integração automática indevida reativada;
- o projeto legado DND/dnd-scribe continua retirado e **não deve ser recriado ou reativado**.

Se a ferramenta conectada mostrar outra conta/time, **abortar** até confirmar contexto correto.

## 6. Verificar env e flags

- server secrets presentes;
- nenhuma secret em `NEXT_PUBLIC_*`;
- Preview e Production separados;
- R2 bucket correto;
- Supabase ref correto;
- allowlists/domains corretos;
- registrar explicitamente os valores efetivos das flags da release antes do deploy, sem registrar secrets.

Flags de release atuais do Edit:

- `TDA_READ_PUBLISHED_DATA` — leitura pública real; validar valor esperado do ambiente;
- `TDA_READ_EDIT_DATA` — habilita leitura server-side do Edit autorizado;
- `TDA_EDIT_UNSAFE` — bypass temporário sem Auth; **não presumir nem alterar** durante preparação de release. Se estiver `true` em production, `/edit` fica administrativamente exposto sem identidade por usuário e isso deve ser aceite explícito da release.

A presença do código do Edit na `main` não autoriza alterar essas flags. Flag/env é operação separada de merge e de deploy.

## 7. Fechar candidato

Antes de publicar, congelar um único SHA candidato e registrar:

- SHA e mensagem;
- PRs/slices incluídos;
- migrations já aplicadas das quais o código depende;
- flags esperadas por ambiente;
- pendências explicitamente excluídas;
- último deployment conhecido como bom;
- plano de rollback.

Não promover uma `main` que continua avançando enquanto o checklist é executado. Se `main` mudar, o candidato muda e as evidências devem ser reconciliadas com o novo SHA.

## 8. Deploy candidato

Publicar apenas o SHA validado. Registrar:

- SHA;
- horário;
- ambiente;
- operador;
- migrations dependentes;
- flags/config não secretas relevantes;
- versão anterior para rollback.

## 9. Smoke pós-deploy

Verificar imediatamente:

- HTTP/runtime;
- `/api/health`;
- páginas principais;
- data fetch;
- imagens/assets;
- auth;
- authorization positiva/negativa;
- logs server-side;
- links antigos;
- navegação canônica de `dnd.faysk.dev` sem vazamento de alias Vercel;
- mobile.

`/api/health` atualmente pode retornar `commit: null` em deployment direto. Nesse caso ele confirma aplicação/ambiente, **não identifica o SHA publicado**; usar o histórico de deployment e a origem imutável registrada para determinar o source SHA.

## 10. Promoção de domínio

DNS/domínio é operação separada. `https://dnd.faysk.dev` já é o domínio oficial do reboot; não alterar DNS como efeito colateral de diagnóstico ou preparação de release.

## Rollback

### App-only

Retornar ao último SHA/release conhecido como bom.

### App + migration backward-compatible

Rollback do app pode ocorrer mantendo schema novo se contrato antigo continua válido.

### Migration não compatível

Não executar rollback cego do app. Avaliar migration corretiva/compatibilidade primeiro.

### Conteúdo publicado incorretamente

Pode exigir arquivar/unpublish publication, invalidar cache/media e revisar visibility; não basta rollback de JavaScript.

## Critérios para abortar release

- CI vermelha ou ainda não terminal para o SHA candidato;
- conta Vercel incerta;
- migration drift;
- secret/config não confirmado;
- flags do Edit não reconciliadas com o aceite da release;
- conteúdo privado aparecendo em payload público;
- navegação pública troca `dnd.faysk.dev` por alias de infraestrutura;
- rollback impossível/não compreendido;
- erro de runtime relevante no smoke.

## Pós-release

- registrar resultado;
- atualizar infrastructure/status se mudou;
- anexar evidência em `docs/operations/deployments.md`;
- abrir issue/ADR para dívida descoberta;
- não deixar workaround operacional apenas em chat;
- revisar custos/erros quando feature usa serviço externo novo.

## Estado operacional verificado — 2026-09-07

### Production atual

- team: `projeto-desenv-6905s-projects` (`team_9wuTfarCQ3L63xtufPKUDzi0`);
- project: `tda` (`prj_hDiDvvRiesg3qCDekGWE8JQMkIyH`);
- único deployment existente: `dpl_CHFi2UCFGZjE5shTj7UvsghHtRPe`;
- target/state: `production` / `READY`;
- source SHA autoritativo registrado: `a7e9053ff2d3f42b6b110558bb51a8e2105125ec`;
- domínio oficial: `https://dnd.faysk.dev`;
- aliases de infraestrutura conhecidos: `https://tda-three.vercel.app` e `https://tda-projeto-desenv-6905s-projects.vercel.app`;
- `/api/health` responde `application=tda`, `environment=production` e `commit=null`; não usar esse campo nulo para inferir versão.

### Próximo candidato — ainda aberto, sem autorização de publicação

Snapshot inicial da coordenação foi `f4d077eb8db63be5eb60b04d208e153c87434600`, mas a `main` avançou durante esta rodada e foi reconfirmada em:

- SHA atual: `20b279c170c433760b5d1ada3d7becf8cff4242b`;
- `main` está 20 commits à frente do source SHA atualmente publicado;
- PR #29 integrada: Edit Workbench temporário/unsafe, default versionado de `TDA_EDIT_UNSAFE=false`;
- PR #31 integrada: navegação/origin pública canônica em `dnd.faysk.dev`;
- PR #33 integrada: `transcript_segments.revision` já aplicada/versionada como primeiro slice da issue #32;
- PR #34 integrada: leitura autorizada do Edit agora expõe `revision` para permitir `expectedRevision` real no próximo write canônico;
- issue #32 segue aberta; persistência atômica update + audit ainda não está concluída;
- PR #26 Lore segue draft e não faz parte do candidato enquanto não for fechada/integrada deliberadamente;
- issue #25 de mídia/R2 segue aberta e independente.

Este SHA `20b279c` é apenas **base de coordenação** e não um release candidate fechado. O SHA final deve ser redefinido quando o escopo encerrar e então passar novamente por `pnpm docs:generate`, contrato completo de testes, CI terminal do SHA exato e checklist desta página.
