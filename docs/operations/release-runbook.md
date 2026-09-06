# Runbook — release, deploy e rollback

> Status: vigente
> Owner: operations/release
> Última revisão: 2026-09-06

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
pnpm check
pnpm build
pnpm test:e2e
```

A CI deve ficar verde. Falha não é ignorada por "só ser docs/UI" se o check canônico inclui a área.

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
- navegação/URLs legadas;
- estados loading/empty/error;
- Markdown;
- imagens;
- acessibilidade básica;
- auth quando fizer parte da release.

## 5. Verificar Vercel

**Obrigatório antes de write:**

- account/context: `projeto-desenv-6905`;
- email associado informado: `projeto_desenv@outlook.com`;
- projeto: TDA correto;
- environment: Production/Preview deliberado;
- nenhuma integração automática indevida reativada.

Se a ferramenta conectada mostrar outra conta/time, **abortar** até confirmar contexto correto.

## 6. Verificar env

- server secrets presentes;
- nenhuma secret em `NEXT_PUBLIC_*`;
- Preview e Production separados;
- R2 bucket correto;
- Supabase ref correto;
- allowlists/domains corretos.

## 7. Deploy candidato

Publicar apenas o SHA validado. Registrar:

- SHA;
- horário;
- ambiente;
- operador;
- migrations dependentes;
- versão anterior para rollback.

## 8. Smoke pós-deploy

Verificar imediatamente:

- HTTP/runtime;
- páginas principais;
- data fetch;
- imagens/assets;
- auth;
- authorization positiva/negativa;
- logs server-side;
- links antigos;
- mobile.

## 9. Promoção de domínio

DNS/domínio é operação separada. Só apontar domínio principal depois de candidato estável.

O domínio legado deve permanecer recuperável durante janela de migração definida, sem manter duas bases/frontends como arquitetura permanente.

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

- CI vermelha;
- conta Vercel incerta;
- migration drift;
- secret/config não confirmado;
- conteúdo privado aparecendo em payload público;
- rollback impossível/não compreendido;
- erro de runtime relevante no smoke.

## Pós-release

- registrar resultado;
- atualizar infrastructure/status se mudou;
- abrir issue/ADR para dívida descoberta;
- não deixar workaround operacional apenas em chat;
- revisar custos/erros quando feature usa serviço externo novo.

## Estado atual

Até a revisão de 2026-09-06, **o reboot ainda não foi deployed**. Este runbook prepara a operação futura; executar deployment exige decisão explícita e conta correta.
