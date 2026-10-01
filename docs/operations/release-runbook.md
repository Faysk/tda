# Release, deploy e rollback

> Status: vigente
> Owner: operations / release
> Última revisão: 2026-10-01
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
7. smoke técnico + conteúdo público semântico;
8. promote do mesmo artifact;
9. canonical verification + repetição do smoke semântico;
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

O smoke técnico continua verificando identidade do artefato, mas sucesso HTTP não
equivale a conteúdo utilizável. O gate semântico público roda no staged deployment
**antes do promote** e novamente no origin canônico **depois do promote**.

Contrato mínimo:

- `/` e `/campanhas` precisam declarar `ready` ou um `empty` legítimo;
- `dependency_unavailable` falha mesmo quando a resposta é 200;
- `/sessoes` deve seguir redirect e terminar em `/campanhas/sessoes` no mesmo origin;
- diretório vazio + arquivo com sessões é inconsistência e falha;
- quando o arquivo contém sessões publicadas, ao menos um link de detalhe campaign-qualified é aberto e precisa declarar `ready`;
- bodies não são registrados no log; somente SHA, rota, status/resultado, destino final e horário.

O registry multi-campaign continua fail-closed para falhas reais. A compatibilidade
estreita de #1225 pode servir somente a campaign histórica conhecida quando o
erro comprova o gap das colunas first-class; nesse modo o smoke valida as páginas
resultantes, mas não considera o registry novo ativado. Erro não classificado,
falha do fallback, permissão ou conectividade continuam
`dependency_unavailable` e bloqueiam o promote. A ativação do registry
first-class mantém seu gate operacional próprio, sem transformar `/api/health`
em probe de banco.

Depois do promote, continuar verificando:

- `/api/health`;
- `/api/version`;
- SHA/release;
- smoke semântico público;
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

Falha do smoke staged ocorre antes do promote e deve preservar o alias anterior.
Se o smoke canônico falhar depois do promote, o run deve registrar explicitamente
que recovery é necessário, com o SHA que falhou e esta ação:

1. promover/rollback para o deployment anterior saudável;
2. confirmar health/version **e** smoke semântico público no origin canônico;
3. corrigir via nova PR e nova Production.

Não mascarar a falha mudando o estado para `empty` nem removendo o gate sem
evidência de falso positivo.

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
