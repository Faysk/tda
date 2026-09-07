# Integração Vercel

> Status: production ativa; publicação manual controlada
> Owner: operations/hosting
> Última revisão: 2026-09-07

## Guardrail obrigatório

Antes de **qualquer** operação de projeto, env, domain ou deployment do TDA, verificar o contexto correto:

- conta/contexto esperado: `projeto-desenv-6905`;
- email informado pelo proprietário: `projeto_desenv@outlook.com`;
- team: `projeto-desenv-6905s-projects` (`team_9wuTfarCQ3L63xtufPKUDzi0`);
- project: `tda` (`prj_hDiDvvRiesg3qCDekGWE8JQMkIyH`).

Uma integração/tool que mostre outro time/conta não deve ser usada para alterar o TDA sem confirmação inequívoca de ownership. Em 2026-09-07 o ChatGPT/Vercel MCP foi reautorizado no contexto correto e o acesso aos IDs acima foi confirmado antes da primeira mutação.

## Estado documentado

O projeto `tda` está ativo na Vercel correta, plano Hobby e Node 24. O primeiro deployment do reboot foi publicado manualmente em production em 2026-09-07 e terminou `READY`.

A publicação atual corresponde ao source SHA `a7e9053ff2d3f42b6b110558bb51a8e2105125ec`, deployment `dpl_CHFi2UCFGZjE5shTj7UvsghHtRPe`. O domínio oficial de production é `https://dnd.faysk.dev`; os aliases Vercel permanecem disponíveis para diagnóstico.

O projeto continua sem integração Git automática como gatilho de publicação; `git.deploymentEnabled=false` permanece vigente.

O projeto Vercel legado `DND/dnd-scribe` foi excluído em operação separada e verificada. Ele não é fallback, não deve ser recriado para rollback e não muda o fato de que `dnd.faysk.dev` serve o novo projeto TDA. Evidência: [Retirada do projeto Vercel legado](../operations/legacy-retirement.md).

## Política de deploy

`main` e `Preview` são branches de código, **não gatilhos automáticos de deploy**.

Razões:

- controlar cota/custo;
- evitar publicação acidental;
- exigir candidato validado;
- separar merge de release.

Quando o conector usado para publicar não aceitar uma Git ref diretamente, é permitido um deployment direto desde que a origem seja fixada por SHA imutável e o método seja registrado no histórico operacional. Production #001 usou o tarball do GitHub preso ao SHA autorizado, instalação com lockfile congelado e build de produção.

## Ambientes

### Local

Pode usar `.env.local`, nunca versionado. Configuração ausente deve produzir estado explícito.

### Preview/homologação

Não deve receber secret de produção ou acesso irrestrito a conteúdo real por padrão. Preferir dados isolados/autorizados.

### Production

Só após aceite da entrega, validação completa e verificação da conta/contexto Vercel.

Production está ativa desde 2026-09-07. Publicar código novo em `main` não atualiza production por si só; exige nova autorização e novo evento de deployment.

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
- CI verde e terminal para esse SHA exato;
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

No Production #001, `/` e `/api/health` responderam HTTP 200, dados reais foram renderizados e a consulta de runtime errors não encontrou erros no intervalo verificado logo após a publicação.

## Rollback

Preferir rollback por SHA/release conhecido. Não manter duas versões públicas concorrentes do frontend como estratégia normal.

Production #001 é o primeiro ponto de rollback reproduzível do reboot. Não havia deployment anterior do reboot na Vercel quando ele foi publicado.

Rollback de código e rollback de domínio são operações distintas. Se o problema estiver apenas no apontamento de `dnd.faysk.dev`, restaurar a associação/DNS anterior conhecida sem recorrer ao projeto legado removido. Se schema mudou, verificar compatibilidade backward antes de rollback do app; uma migration incompatível pode impedir simples retorno de código.

## Domínio

O domínio canônico de production é `https://dnd.faysk.dev`.

No primeiro instante do Production #001, o reboot estava acessível apenas pelos aliases Vercel. Depois, em uma operação separada, `dnd.faysk.dev` foi associado ao projeto `tda` e passou a servir o mesmo deployment, sem novo build.

Validação de `2026-09-07T04:04Z`:

- `https://dnd.faysk.dev/` -> HTTP 200;
- `https://dnd.faysk.dev/api/health` -> HTTP 200;
- health: `ok=true`, `application=tda`, `environment=production`;
- HTTPS ativo;
- resposta servida pela Vercel.

A consulta DNS auxiliar falhou durante a documentação, então o valor exato do registro Cloudflare não deve ser inventado nem inferido neste arquivo. Em operações futuras, registrar tipo, nome, alvo, proxy status e TTL sempre que essa evidência estiver disponível.

### Contrato de URL pública

`dnd.faysk.dev` é identidade pública do produto. URLs `*.vercel.app` são aliases de infraestrutura para diagnóstico e **não podem aparecer como destino normal de navegação, canonical metadata ou compartilhamento**.

Regras vigentes:

- links internos do shell público usam caminhos relativos e navegação nativa do navegador para preservar o origin pelo qual o usuário entrou;
- `metadataBase` do App Router usa explicitamente `https://dnd.faysk.dev`;
- páginas de sessão emitem canonical sob `https://dnd.faysk.dev/sessoes/<id>`;
- copiar/compartilhar sessão reconstrói a URL com o origin canônico, mesmo se a página tiver sido aberta por um alias de infraestrutura;
- o teste E2E de navegação valida que clicar da Home para `/sessoes` não troca o origin atual;
- mudanças futuras não devem reintroduzir `next/link` diretamente no shell público sem demonstrar em homologação e production que o hostname permanece canônico durante navegação cliente.

### Contrato de preview social / metadata SSR

Prévia de link é um contrato **da página pública**, independente de WhatsApp, Discord, Slack, redes sociais ou qualquer CTA no produto. Colar uma URL pública deve ser suficiente para que um crawler compatível encontre os metadados; nenhum botão específico de plataforma é requisito para isso.

A implementação canônica vive em `src/config/public-metadata.ts`. Toda página pública deve usar esse boundary, diretamente ou por adapter de domínio, e fornecer:

- título e descrição próprios da página;
- `canonical` absoluto em `https://dnd.faysk.dev`;
- `og:url` absoluto e idêntico ao canonical da página;
- Open Graph com título, descrição, `siteName`, locale, tipo e imagem;
- Twitter Card coerente com o mesmo título, descrição e imagem;
- `og:image` em URL HTTPS absoluta e pública, sem autenticação;
- `alt`, MIME e dimensões quando esses dados forem conhecidos.

Para sessões publicadas, `src/features/sessions/metadata.ts` escolhe `heroImage` e depois `coverImage`. Como o schema vigente não fornece MIME/dimensões dessas imagens, o metadata não inventa esses valores; mantém URL e alt. Quando uma página não possui artwork apropriada, o fallback oficial é `https://dnd.faysk.dev/og/default`, gerado pelo app em PNG `1200x630` com identidade visual TDA e sem dependência de auth, banco ou JavaScript.

Home, arquivo de sessões e detalhes usam o mesmo contrato. Lores, World Explorer e outras superfícies públicas futuras devem reutilizar `buildPublicMetadata` em vez de criar uma segunda implementação de Open Graph/Twitter. Uma futura superfície pode fornecer artwork própria ou usar o fallback.

O root layout mantém apenas metadata estrutural compartilhável com qualquer rota, como `metadataBase`, template de título e favicon. Ele **não** fornece Open Graph/Twitter genéricos, evitando que `/edit`, 404 ou outra superfície não pública herde uma prévia pública por acidente. `/edit/**` é explicitamente `noindex,nofollow`; páginas de sessão inexistentes entram no fluxo `notFound()` também durante geração de metadata.

Os testes de crawler leem o HTML HTTP bruto com user-agents de preview, sem executar JavaScript, e verificam que as tags estão no `<head>`. O endpoint da imagem fallback também é requisitado sem cookie/token. Testes unitários cobrem duas sessões distintas, uma sessão sem artwork e o uso reaproveitável para caminhos de Lore/World Explorer.

Esse contrato define **o que o TDA serve**, não o layout final escolhido por terceiros. Cada plataforma decide o desenho da prévia e mantém cache/recrawl próprios; não há garantia de aparência idêntica nem atualização instantânea depois de uma mudança de metadata.

Em 2026-09-07 foi observado em production um vazamento do alias `tda-three.vercel.app` ao navegar a partir de `dnd.faysk.dev`, apesar de os `href` renderizados serem relativos e as rotas diretas em `dnd.faysk.dev` responderem HTTP 200. A correção foi tratada no código como boundary de navegação pública, sem transformar aliases Vercel em URLs de produto.

### Estado da correção de origem canônica

A PR #31 foi integrada à `main` e o código vigente contém o origin canônico `https://dnd.faysk.dev` e o teste de regressão correspondente. Isso é evidência de **correção no código**.

O histórico de deployments, porém, ainda registra como publicação atual o Production #001 no source SHA `a7e9053ff2d3f42b6b110558bb51a8e2105125ec`, anterior à integração da PR #31. Portanto, até existir nova entrada em `docs/operations/deployments.md` com smoke pós-deploy, **não afirmar que a correção da PR #31 está efetivamente publicada**.

Os critérios operacionais para a próxima release ficam em [Runbook — release, deploy e rollback](../operations/release-runbook.md), que é o owner do procedimento. Esta conciliação documental não autoriza deployment nem mudança de DNS.

## Cotas

Plano Hobby e deploys/CLI podem possuir limites. Não reativar auto-deploy sem decisão explícita apenas por conveniência.

## Failure modes

### Conta errada

Abortar operação. Não criar "outro tda" em outra conta para continuar.

### Env faltando

Deployment deve falhar/mostrar estado explícito, não mascarar com dados fake.

### Build verde, runtime quebrado

Verificar env/runtime/data boundary antes de promover domínio.

### Metadado de commit ausente

Deployment direto pode não preencher metadados Git da Vercel. No Production #001, `/api/health` retornou `commit: null`; o SHA autoritativo foi garantido pelo source tarball fixado e registrado em `docs/operations/deployments.md`. Não inferir um SHA a partir do horário do deploy.

### Migration incompatível

Tratar app+database como release coordenada e seguir rollback planejado.

## Referências

- [Histórico de deployments](../operations/deployments.md)
- [Runbook de release](../operations/release-runbook.md)
- [Retirada do projeto Vercel legado](../operations/legacy-retirement.md)
- [Política resumida](../releases.md)
- [Infraestrutura e estado](../infrastructure.md)
