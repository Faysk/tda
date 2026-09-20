# Release, deploy e rollback

> Status: vigente
> Owner: operations / release
> Última revisão: 2026-09-20
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
