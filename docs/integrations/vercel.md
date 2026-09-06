# Integração Vercel

> Status: preparado; reboot não publicado
> Owner: operations/hosting
> Última revisão: 2026-09-06

## Guardrail obrigatório

Antes de **qualquer** operação de projeto, env, domain ou deployment do TDA, verificar o contexto correto:

- conta/contexto esperado: `projeto-desenv-6905`;
- email informado pelo proprietário: `projeto_desenv@outlook.com`.

Uma integração/tool que mostre outro time/conta não deve ser usada para alterar o TDA sem confirmação inequívoca de ownership.

## Estado documentado

O projeto `tda` foi preparado para Vercel na conta correta, plano Hobby, Node 24, sem deploy do reboot e sem integração Git automática como gatilho de publicação.

## Política de deploy

`main` e `Preview` são branches de código, **não gatilhos automáticos de deploy**.

Razões:

- controlar cota/custo;
- evitar publicação acidental;
- exigir candidato validado;
- separar merge de release.

## Ambientes

### Local

Pode usar `.env.local`, nunca versionado. Configuração ausente deve produzir estado explícito.

### Preview/homologação

Não deve receber secret de produção ou acesso irrestrito a conteúdo real por padrão. Preferir dados isolados/autorizados.

### Production

Só após aceite da entrega, validação completa e verificação da conta/contexto Vercel.

## Env vars

Documentar **nomes e finalidade**, nunca valores secretos.

Ao adicionar env:

1. classificar public vs server secret;
2. definir em quais ambientes existe;
3. validar que `NEXT_PUBLIC_*` é realmente seguro para browser;
4. documentar dependência no runbook;
5. não copiar production secret para Preview sem necessidade.

## Release candidate

Antes de deployment:

- SHA conhecido;
- CI verde;
- instalação/build limpos;
- testes browser desktop/mobile;
- dados/permissões revisados;
- migrations necessárias já reconciliadas;
- rollback definido;
- conta Vercel conferida.

## Promoção

Deploy deve ser consequência de candidato aprovado, não forma de testar cada mudança.

Após publicar:

- health/runtime;
- rotas principais;
- auth quando aplicável;
- acesso público/privado;
- assets/media;
- domínio;
- logs de erro;
- smoke mobile/desktop.

## Rollback

Preferir rollback por SHA/release conhecido. Não manter duas versões públicas concorrentes do frontend como estratégia normal.

Se schema mudou, verificar compatibilidade backward antes de rollback do app. Uma migration incompatível pode impedir simples retorno de código.

## Domínio

O domínio legado continua preservado enquanto reboot não é aprovado para substituição. Troca de DNS/domínio é operação distinta de configurar projeto/variáveis.

## Cotas

Plano Hobby e deploys/CLI podem possuir limites. Não reativar auto-deploy sem decisão explícita apenas por conveniência.

## Failure modes

### Conta errada

Abortar operação. Não criar "outro tda" em outra conta para continuar.

### Env faltando

Deployment deve falhar/mostrar estado explícito, não mascarar com dados fake.

### Build verde, runtime quebrado

Verificar env/runtime/data boundary antes de promover domínio.

### Migration incompatível

Tratar app+database como release coordenada e seguir rollback planejado.

## Referências

- [Runbook de release](../operations/release-runbook.md)
- [Política resumida](../releases.md)
