# World Entity Media — smoke editorial de Production

> Status: vigente
> Owner: integrations/media + world
> Última revisão: 2026-09-28
> Issue de ativação: [#287](https://github.com/Faysk/tda/issues/287)

Este runbook fecha o gate positivo de World Entity Media sem criar identidade, entidade ou lease artificiais. O objetivo é exercer o mesmo boundary editorial usado por uma pessoa autorizada no Mundo: sessão real, capabilities reais, lease real, upload same-origin, draft persistido e publicação atômica.

## Pré-condições

- Production saudável em `https://dnd.faysk.dev`;
- `TDA_WORLD_ENTITY_MEDIA_ENABLED=true`;
- buckets privado/público e credenciais server-only validados pela Production CD;
- conta editorial real com `campaign.content.edit` e `campaign.world.layout.edit`;
- entidade real já existente no draft/campanha;
- duas imagens PNG/WebP canônicas e diferentes, cada uma com até 8 MiB;
- browser autenticado normalmente pelo fluxo do produto.

Não usar service-role, SQL direto, usuário sintético ou entidade descartável para substituir este smoke. Esses atalhos não provam o boundary de autorização que a #287 pretende aceitar.

## Exportar a sessão para Playwright

O script recebe um arquivo local `storageState` do Playwright. Esse arquivo contém credenciais de sessão e **nunca** deve entrar no Git, issue, logs, chat, artifact de CI ou diretório compartilhado.

A sessão deve ser criada por login normal no TDA e exportada localmente para um caminho ignorado pelo Git. O harness não recebe senha, token Discord ou segredo Supabase por argumento.

## Executar

```bash
pnpm smoke:world-media:production -- \
  --storage-state <caminho-local>/tda-production-storage-state.json \
  --entity-id <uuid-real-da-entidade> \
  --primary-image <portrait-canônico-1.webp> \
  --replacement-image <portrait-canônico-2.webp> \
  --confirm-production
```

Use `--headed` somente quando inspeção visual for necessária.

O comando é deliberadamente fixado em `https://dnd.faysk.dev`; não aceita origem arbitrária. Ele falha se a sessão redirecionar para login/conta, se o botão de Conduzir não estiver disponível ou se a lease real não aparecer em `sessionStorage`.

## O que o harness prova

1. abre o Mundo com a sessão editorial existente;
2. entra em **Conduzir**, obtendo a lease real do produto;
3. seleciona a entidade real pelo UUID;
4. envia a primeira imagem pelo editor normal;
5. aguarda finalização e asset UUID;
6. aguarda o draft ficar salvo e publica pelo botão normal;
7. recarrega o Mundo e exige portrait projetado;
8. troca por uma segunda imagem realmente diferente e publica;
9. confirma a projeção da troca;
10. remove o portrait no draft e publica;
11. recarrega e exige ausência do portrait;
12. envia novamente os mesmos bytes da segunda imagem, exigindo reutilização do mesmo asset UUID;
13. publica e deixa a entidade novamente com portrait;
14. imprime um receipt local com entity/asset IDs e flags de replace/remove/rebind.

O receipt não contém cookie, token, object key privada nem bytes da imagem.

## Evidência adicional obrigatória para fechar #287

Depois do harness, consultar somente metadata não sensível e registrar na issue:

- `media_assets`: asset final existe, hash/tamanho/MIME/dimensões coerentes e `read_back_verified=true`;
- `entity_media_bindings`: binding final aponta para o asset esperado e para a mesma campaign/entity;
- projeção final: o Mundo resolve o portrait esperado;
- para `public_web`: asset terminou `verified_public`, delivery público foi verificado e a URL pública deriva da key imutável;
- para audiência não pública: confirmar que nenhuma URL/objeto privado foi exposto publicamente;
- ausência de binding inesperado e ausência de estado parcial promovido;
- pelo menos um negativo de autorização/integridade já documentado no mesmo ciclo de aceite.

Nunca publicar valores de credencial ou conteúdo privado na issue.

## Escolha do conteúdo

O smoke deve usar conteúdo real que faça sentido permanecer na campanha. Não fazer upload de placeholder só para satisfazer checklist.

Se a entidade escolhida não for `public_web`, promoção para `tda-media-public` não é esperada; o gate deve registrar explicitamente que a entrega pública é não aplicável naquele caso. Para provar promoção/delivery, usar somente uma entidade cuja audiência real já autorize publicação web.

## Falha e recuperação

- Falha antes de publicar: manter a aba/sessão e corrigir a causa; o draft deve continuar recuperável.
- Falha de promoção/read-back: não forçar binding, não alterar status manualmente e não consumir a lease como sucesso.
- Falha depois de publish confirmado: consultar receipt/dados canônicos antes de repetir para evitar confundir retry com nova publicação.
- Nunca apagar objeto ou linha de Production para “limpar” teste sem primeiro provar que é órfão e que nenhuma referência canônica o usa.

A #287 só deve ser fechada depois que o receipt do harness e a leitura final de metadata concordarem.
