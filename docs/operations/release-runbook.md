# Runbook — release, deploy e rollback

> Status: vigente
> Owner: operations/release
> Última revisão: 2026-09-08

## Objetivo

Publicar o TDA de maneira deliberada e recuperável. **Merge não significa deploy.**

## Pré-condições

- escopo da release fechado;
- PR revisada;
- SHA candidato conhecido;
- CI terminal verde para **esse SHA exato**;
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

A CI deve ficar verde. Falha não é ignorada por "só ser docs/UI" se o check canônico inclui a área. Se o head mudar após a validação, aguardar novamente o estado terminal da CI do novo SHA antes de integrar ou publicar.

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
- assets apontam para origens permitidas;
- páginas privadas, administrativas ou ainda não publicadas não expõem título narrativo, resumo, imagem, canonical social ou qualquer conteúdo sensível em metadata/preview para crawlers.

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

O teste automatizado `tests/navigation-origin.spec.ts` deve passar junto com o restante do Playwright quando a release contém ou sucede a correção de origem canônica da PR #31.

### Metadata e prévias automáticas de URL

"WhatsApp" neste contexto significa **a prévia automática gerada quando qualquer URL pública do site é colada em WhatsApp ou outro consumidor de Open Graph**, não um botão/CTA específico no produto. A implementação de metadata pertence ao recorte backend/documentação responsável por esse contrato; não duplicar a mesma implementação em frentes paralelas.

Para cada tipo de página pública incluído no candidato, validar o contrato de metadata por página:

- título específico e coerente com a página;
- resumo/description específico e seguro para publicação;
- imagem pública em URL absoluta, acessível sem autenticação e adequada para crawler;
- `canonical` absoluto no domínio oficial;
- `og:url` coerente com o canonical;
- Open Graph com título, descrição e imagem esperados;
- Twitter metadata equivalente e coerente;
- nenhuma referência normal de compartilhamento apontando para `*.vercel.app`.

Não considerar o requisito concluído apenas porque o código foi mergeado. Há três estados distintos que devem ser registrados separadamente quando relevantes:

1. **código integrado** — implementação presente no SHA candidato;
2. **metadata publicada** — HTML servido pela production contém os valores esperados;
3. **cache externo atualizado** — WhatsApp, redes sociais e outros crawlers podem continuar exibindo preview antigo até recrawl/cache próprio; isso não deve ser confundido com o conteúdo efetivamente servido pelo TDA.

## 5. Verificar Vercel

**Obrigatório antes de write:**

- account/context: `projeto-desenv-6905`;
- email associado informado: `projeto_desenv@outlook.com`;
- projeto: TDA correto;
- environment: Production/Preview deliberado;
- nenhuma integração automática indevida reativada.

Se a ferramenta conectada mostrar outra conta/time, **abortar** até confirmar contexto correto. O contrato de domínio e aliases é definido em [Integração Vercel](../integrations/vercel.md); este runbook define apenas a verificação operacional de release.

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

### Verificação obrigatória da navegação canônica

Na primeira release que contém a PR #31 — e em qualquer release que altere routing, shell público, metadata ou compartilhamento — executar no domínio oficial `https://dnd.faysk.dev`:

1. abrir `/` e confirmar que a URL final continua em `dnd.faysk.dev`;
2. clicar em **Explorar as sessões** e no link **Sessões** do header; em ambos os casos o hostname deve permanecer `dnd.faysk.dev`;
3. abrir uma sessão, usar **Todas as sessões** e, quando existirem, **Sessão anterior/Próxima sessão**; nenhuma navegação pode trocar o hostname para `*.vercel.app`;
4. testar o bridge de URL legada (`/#/sessao/<id>/resumo`) a partir do domínio oficial e confirmar que o destino final continua em `dnd.faysk.dev`;
5. inspecionar uma página de sessão e confirmar que o canonical metadata aponta para `https://dnd.faysk.dev/sessoes/<id>`;
6. testar copiar/compartilhar uma sessão e confirmar que a URL gerada usa `https://dnd.faysk.dev`, nunca um alias de infraestrutura;
7. confirmar que `/`, `/sessoes`, pelo menos uma `/sessoes/<id>` e `/api/health` respondem sem redirect final para `*.vercel.app`.

Se qualquer passo acima expuser `tda-three.vercel.app` ou outro `*.vercel.app` como destino normal iniciado a partir de `dnd.faysk.dev`, **abortar a release/promoção** e tratar como regressão. Aliases Vercel continuam permitidos apenas para diagnóstico conforme o contrato de hosting.

### Verificação obrigatória de metadata servida para crawlers

Quando a release contém alteração de metadata/social preview, validar diretamente o **HTML servido pela production** — não apenas o DOM hidratado no browser nem o código fonte no Git:

1. requisitar a URL pública sem sessão/autenticação e inspecionar o HTML retornado;
2. confirmar `title`, description, canonical, `og:url`, `og:title`, `og:description`, `og:image` e Twitter metadata conforme o contrato da página;
3. confirmar que `og:image`/imagem social é URL absoluta pública, responde com sucesso sem cookie/token e possui MIME de imagem esperado;
4. confirmar que a imagem não depende de origem privada, localhost, URL temporária ou alias indevido;
5. validar ao menos Home, listagem pública e uma página de detalhe representativa; ampliar a amostra quando houver templates diferentes;
6. para qualquer rota privada/autenticada, confirmar que resposta pública/crawler não revela conteúdo privado por metadata, imagem ou descrição;
7. registrar separadamente evidência de **metadata publicada no HTML** e eventual comportamento de **cache externo**. Cache antigo de WhatsApp/rede social não autoriza redeploy por si só se o HTML atual já estiver correto.

## 9. Domínio

`dnd.faysk.dev` já é o domínio oficial do TDA novo. Releases normais **não devem alterar DNS nem reassociar domínio**.

Mudança de DNS/domínio é operação separada e exige autorização própria. O antigo projeto Vercel `DND/dnd-scribe` foi retirado e não deve ser recriado nem tratado como caminho de rollback; a evidência está em [Retirada do projeto Vercel legado](legacy-retirement.md).

## Checklist enxuto — próxima publicação de Pipipi (#99)

Este gate vale apenas para a lore Pipipi e não transforma features independentes ainda incompletas em bloqueios artificiais. Grafo, cinematic, ASR/import e outras frentes só bloqueiam esta publicação se introduzirem uma dependência direta no SHA candidato.

### Candidato e rastreabilidade

- [ ] Pipipi está integrada à `main` por PR revisada; **não publicar enquanto a implementação de `/lore/pipipi` estiver apenas local, em draft ou fora da `main`**.
- [ ] Registrar o **SHA exato da `main` que contém Pipipi** imediatamente antes da validação final. Estado observado ao preparar este gate: `main=80eab3a8c267e3e3900cd7c9399f23bf914d994d`; este SHA é baseline de preparação, **não candidato de Pipipi**, porque a issue #99 ainda não tem PR Pipipi aberto/integrado.
- [ ] Aguardar CI terminal verde para esse SHA exato; se a `main` avançar, repetir a associação entre SHA e evidências antes de publicar.
- [ ] Confirmar a origem da production anterior por evidência imutável de deployment/build, nunca pelo `commit` do `/api/health` quando ele vier `null`. No preparo deste gate, o deployment ativo observado foi `dpl_Cmw9hpaqunsCiba2K4CC5p2gz3WE` (`READY`, alias `dnd.faysk.dev`) e o build log fixa `TDA_RELEASE_SHA=de7e02c66595f34e44efa8d9e09a1d0098afae18`; usar essa associação como baseline de rollback até existir registro operacional posterior que a substitua.

### Conteúdo e privacidade

- [ ] Revisão humana confirma que o texto aprovado de Pipipi chegou intacto à página e que rótulos/elementos da referência visual não foram confundidos com fatos narrativos.
- [ ] A rota pública entrega somente o conteúdo explicitamente aprovado; não transportar transcrições privadas, notas de revisão, drafts ou metadados de audience não públicos.
- [ ] Futuras áreas privadas relacionadas à lore não emitem preview público com título, resumo, imagem ou conteúdo sensível.

### Imagens e R2

- [ ] As sete WebPs autorizadas para Pipipi (`pipipi`, `casa`, `corredores`, `super_herois`, `cadeira`, `ultimo_dia`, `acordou`) estão no consumidor esperado; `pipipi` é hero/preview.
- [ ] Se o consumidor usar R2, cada objeto possui upload/read-back verificado, SHA-256, MIME, bytes e GET HTTPS anônimo válido em `media.dnd.faysk.dev`; URL planejada, objeto presente no bucket ou dry-run não contam como `verified-public`.
- [ ] Não usar `tda-media-private`/`tda-media-preview` como fallback público e não colocar áudio bruto nessa entrega.

### OG específico

- [ ] `/lore/pipipi` serve HTML com título, resumo e canonical próprios; `og:url`, Open Graph e Twitter apontam para a URL oficial no `dnd.faysk.dev`.
- [ ] `og:image` usa a arte específica de Pipipi em URL HTTPS absoluta, pública e acessível sem cookie/token; card genérico da marca fica apenas como fallback de falha/ausência real.
- [ ] Inspecionar o HTML bruto com user-agent comum e pelo menos crawlers representativos de WhatsApp/Discord; separar resultado servido pelo TDA de cache externo dos aplicativos.

### Visual e CI

- [ ] Revisão desktop e mobile da página completa: leitura, imagens, conteúdo longo, navegação, foco/teclado, contraste e `prefers-reduced-motion` quando houver movimento.
- [ ] `pnpm check`, `pnpm build` e `pnpm test:e2e` cobertos pela CI terminal do SHA candidato; qualquer teste específico de lore/mídia incluído no recorte também deve estar verde.

### Publicação e rollback

- [ ] Somente depois dos itens anteriores, executar deployment deliberado do SHA candidato; não ativar Git auto-deploy e não consumir deploy para diagnóstico.
- [ ] Após `READY`, confirmar `/lore/pipipi`, sete imagens públicas, HTML OG e runtime errors; registrar evidências em `docs/operations/deployments.md`.
- [ ] Rollback app: reassociar/promover o último deployment production conhecido como bom, mantendo a associação source SHA ↔ deployment ID registrada.
- [ ] Rollback de mídia: restaurar referência/configuração anterior do consumidor; uploads aditivos imutáveis podem permanecer no R2. Não apagar originais/objetos como primeira resposta a rollback.

## Rollback

### App-only

Retornar ao último SHA/release conhecido como bom no projeto TDA atual.

### App + migration backward-compatible

Rollback do app pode ocorrer mantendo schema novo se contrato antigo continua válido.

### Migration não compatível

Não executar rollback cego do app. Avaliar migration corretiva/compatibilidade primeiro.

### Conteúdo publicado incorretamente

Pode exigir arquivar/unpublish publication, invalidar cache/media e revisar visibility; não basta rollback de JavaScript.

## Critérios para abortar release

- CI vermelha ou ainda não terminal no SHA candidato exato;
- conta Vercel incerta;
- migration drift;
- secret/config não confirmado;
- conteúdo privado aparecendo em payload público ou metadata social;
- navegação iniciada em `dnd.faysk.dev` escapando para `*.vercel.app`;
- canonical/share URL usando alias de infraestrutura;
- HTML servido sem metadata pública esperada quando esse contrato faz parte da release;
- imagem social inacessível ao crawler ou exigindo autenticação;
- rollback impossível/não compreendido;
- erro de runtime relevante no smoke.

## Pós-release

- registrar resultado em `docs/operations/deployments.md`;
- atualizar infrastructure/status se mudou;
- registrar explicitamente os critérios de navegação canônica verificados quando a release incluir a PR #31;
- registrar separadamente código integrado, metadata efetivamente publicada e observação de cache externo quando houver mudança de social preview;
- abrir issue/ADR para dívida descoberta;
- não deixar workaround operacional apenas em chat;
- revisar custos/erros quando feature usa serviço externo novo.

## Estado atual

O reboot está publicado em production desde 2026-09-07 no projeto TDA e `https://dnd.faysk.dev` serve o novo produto. O histórico versionado pode ficar atrás do dashboard entre uma publicação e a integração do registro correspondente; por isso **o source SHA de uma production deve ser associado por deployment/build imutável e depois registrado em `docs/operations/deployments.md`**. O `/api/health` com `commit=null` comprova aplicação/ambiente, não provenance de Git.

Para Pipipi #99, este documento registra apenas o gate de publicação. **Nenhum deployment de Pipipi foi executado nesta revisão e a existência deste checklist não significa que a lore esteja integrada, validada ou publicada.**
