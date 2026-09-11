# R2 e mídia — runbook operacional

> Status: vigente
> Owner: integrations/media + operations
> Última revisão: 2026-09-11

Fluxo obrigatório: confirmar identidade/role/audience; validar provenance; escolher o master/fonte de maior fidelidade; calcular SHA-256, MIME, bytes e dimensões; decidir se o consumidor precisa do master, de variante dinâmica ou de derivado físico; validar qualidade/resolução; escolher bucket/key; verificar colisão; fazer upload somente quando autorizado; executar read-back; para mídia pública, validar URL HTTPS anônima e decode; registrar evidência; só então promover referência e validar frontend/social.

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

## Next/Image e derivados já otimizados

`next/image` é entrega, não restauração. Ele não transforma uma fonte pequena em master de alta resolução.

Quando um asset local já é um AVIF/WebP final, pequeno e aprovado, evitar segunda compressão lossy se a economia marginal não compensar perda visual. `unoptimized` é aceitável para esses casos quando o arquivo já tem peso adequado e não há necessidade de variantes responsivas adicionais.

Quando o otimizador for necessário, a fonte entregue a ele deve ter resolução suficiente para a maior variante pedida. `sizes` precisa refletir a largura real do slot para evitar download maior do que o necessário.

## Cenas cinematográficas

Uma cena achatada/static só substitui background + subject se a variante final passar o gate de qualidade do fullscreen. Static de baixa resolução não deve ser esticado para preservar composição.

Se o static falhar:

1. manter o master registrado;
2. voltar temporariamente para layers com maior detalhe útil;
3. limitar cada subject à sua resolução natural quando necessário;
4. documentar a necessidade de flattened master hi-res;
5. reativar static somente após nova inspeção visual.

## Imagem temporariamente abaixo do gate

Se ainda não existe master melhor, qualidade tem prioridade sobre tamanho aparente: limitar o CSS ao detalhe natural do raster é preferível a ampliá-lo 2×. A limitação deve ser claramente temporária e removida quando o master hi-res for publicado.

## Publicação R2

Para as imagens históricas de sessão, o tooling existente é `tools/migrate-session-media-r2.mjs`. O modo padrão recupera/valida sem escrever no R2; `--verify-db --check-r2` faz verificações adicionais. Upload real exige autorização explícita e `--upload`.

Por objeto, registrar URL, HTTP status, Content-Type, bytes, SHA-256, dimensões, decode e horário, sem credenciais ou dados privados. Para derivados, registrar também master/provenance, role, encoder/parâmetros relevantes e superfície-alvo.

## Validação pós-publicação

Verificar:

- GET real e decode;
- dimensões recebidas;
- crop/focal point;
- desktop e mobile;
- 100% de zoom;
- ausência de upscale acima do gate;
- alpha/halo/banding;
- request/bytes finais;
- fallback e estado de erro;
- social/crawler quando aplicável.

Rollback preserva a referência anterior e aborta se houver edição concorrente. Upload aditivo não exige apagar o objeto para desfazer o consumo.
