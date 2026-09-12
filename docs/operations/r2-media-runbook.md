# R2 e mídia — runbook operacional

> Status: vigente
> Owner: integrations/media + operations
> Última revisão: 2026-09-12

Fluxo obrigatório: confirmar identidade/role/audience; validar provenance; escolher o master/fonte de maior fidelidade; calcular SHA-256, MIME, bytes e dimensões; decidir se o consumidor precisa do master, de variante dinâmica ou de derivado físico; validar qualidade/resolução; escolher placement/bucket/key; verificar colisão; fazer upload somente quando autorizado; executar read-back; para mídia pública, validar URL HTTPS anônima e decode; registrar evidência; só então promover referência e validar frontend/social.

## Preparação de imagem

1. partir sempre do master ou da melhor fonte conhecida;
2. nunca gerar um novo lossy a partir de um lossy menor se o master estiver disponível;
3. registrar dimensão natural, role e superfície-alvo;
4. calcular `upscaleRatio = tamanho_exibido / tamanho_natural` no eixo limitante;
5. se `upscaleRatio > 1.50`, interromper: obter master melhor ou limitar o slot;
6. entre 1.15 e 1.50, exigir exceção e inspeção visual explícita;
7. escolher formato/encoder pela imagem real: AVIF para fotografia/ilustração opaca quando adequado; AVIF ou WebP para alpha após teste de borda; PNG quando lossless for necessário;
8. ajustar compressão procurando o menor arquivo visualmente indistinguível ou quase indistinguível do master na superfície-alvo;
9. revisar em 100% de zoom e nos viewports reais antes de considerar o derivado apto.

PSNR/SSIM e tamanho de arquivo podem ser registrados como apoio, mas não aprovam a imagem sozinhos. Rostos, cabelo, bordas transparentes, texto, gradientes e textura fina exigem inspeção humana.

## Contrato de entrega

O browser deve receber imagem como recurso binário normal:

`master -> derivado validado -> binário publicado -> URL -> <img>/<Image>`

Não usar em Production como solução permanente:

- fetch de `.b64` no browser;
- concatenação de fragmentos Base64;
- `data:image/...` para artwork editorial principal;
- GIF 1×1 cujo único papel seja aguardar JavaScript substituir `src`;
- alias com formato/MIME divergentes sem contrato explícito;
- redirect como único smoke de publicação.

Se alguma ferramenta só conseguir transportar binário em Base64, decodificar **antes do build**, validar assinatura/MIME/dimensões/hash e publicar o arquivo binário resultante. O browser nunca precisa saber que Base64 existiu.

Para mídia pequena e fortemente code-coupled, o binário pode ser materializado no bundle/runtime. Para mídia pública maior/reutilizável, preferir R2 no custom domain. Não mover uma mídia entre placements somente para contornar limitação temporária de tooling.

## Next/Image e derivados já otimizados

`next/image` é entrega, não restauração. Ele não transforma uma fonte pequena em master de alta resolução.

Quando um asset local já é um AVIF/WebP final, pequeno e aprovado, evitar segunda compressão lossy se a economia marginal não compensar perda visual. `unoptimized` é aceitável para esses casos quando o arquivo já tem peso adequado e não há necessidade de variantes responsivas adicionais.

Quando o otimizador for necessário, a fonte entregue a ele deve ter resolução suficiente para a maior variante pedida. `sizes` precisa refletir a largura real do slot para evitar download maior do que o necessário.

Arquivos criados para `public/` precisam existir antes de `next build`. Materialização em build é válida somente quando determinística, validada e concluída antes do framework capturar o artefato.

## R2 e URLs públicas

Production usa custom domain, não `r2.dev`. Para objetos content-addressed, preferir URL final direta e cacheável.

Antes de apontar consumidor para um objeto:

1. GET/HEAD anônimo real;
2. confirmar status 200/206;
3. confirmar `Content-Type` real;
4. confirmar bytes/hash e dimensões;
5. decodificar em browser real;
6. conferir que extensão/preload/metadata não mentem sobre o formato;
7. registrar timestamp/evidência.

Compatibilidade same-origin pode ser usada durante migração, mas deve streamar bytes reais com MIME correto, falhar fechado quando upstream falha e ter plano explícito de remoção. Evitar cadeias `site -> 307 -> R2` para mídia crítica quando elas não acrescentam valor.

## Cenas cinematográficas

Uma cena achatada/static só substitui background + subject se a variante final passar o gate de qualidade do fullscreen. Static de baixa resolução não deve ser esticado para preservar composição.

Se o static falhar:

1. manter o master registrado;
2. voltar temporariamente para layers com maior detalhe útil quando isso não altera direção visual aprovada;
3. limitar cada subject à sua resolução natural quando necessário;
4. documentar a necessidade de flattened master hi-res;
5. reativar static somente após nova inspeção visual.

Se a composição estática for editorialmente obrigatória, não trocar o enquadramento apenas para esconder baixa resolução: produzir novo flattened master com os mesmos enquadramento e conteúdo.

## Imagem temporariamente abaixo do gate

Se ainda não existe master melhor, qualidade tem prioridade sobre tamanho aparente: limitar o CSS ao detalhe natural do raster é preferível a ampliá-lo 2×. A limitação deve ser claramente temporária e removida quando o master hi-res for publicado.

## Publicação R2

Para as imagens históricas de sessão, o tooling existente é `tools/migrate-session-media-r2.mjs`. O modo padrão recupera/valida sem escrever no R2; `--verify-db --check-r2` faz verificações adicionais. Upload real exige autorização explícita e `--upload`.

Por objeto, registrar URL, HTTP status, Content-Type, bytes, SHA-256, dimensões, decode e horário, sem credenciais ou dados privados. Para derivados, registrar também master/provenance, role, encoder/parâmetros relevantes e superfície-alvo.

## Validação pós-publicação

Verificar:

- GET real e decode;
- dimensões naturais recebidas pelo browser;
- dimensões renderizadas e `upscaleRatio` efetivo;
- crop/focal point;
- desktop 1080p, desktop 2K e mobile quando forem superfícies suportadas;
- 100% de zoom;
- alpha/halo/banding;
- request/bytes finais;
- ausência de `requestfailed` nos recursos críticos;
- ausência de Base64/data URI como mídia editorial principal;
- fallback e estado de erro;
- social/crawler quando aplicável.

## Gate de release

CI de código não basta. Para páginas com mídia crítica, o E2E deve abrir a página em browser real e confirmar que as imagens terminaram `complete`, têm `naturalWidth/naturalHeight > 0` e não ultrapassam o gate de upscale.

Preview CD e Production CD devem incluir smoke das rotas de lore/media relevantes no corte. Um release que só verifica `/`, `/api/health` e `/sessoes` não prova saúde de mídia.

Quando uma nova lore introduz objetos R2, o smoke do próprio corte deve testar esses objetos/aliases antes de promoção a Production. Se mídia crítica falhar, promoção falha.

Rollback preserva a referência anterior e aborta se houver edição concorrente. Upload aditivo não exige apagar o objeto para desfazer o consumo.
