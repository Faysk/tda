# R2 — checklists de mídia

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-12

## Antes do upload

- identidade canônica confirmada;
- audience e role aprovados;
- fonte/provenance registrada;
- SHA-256, MIME, bytes e dimensões conferidos;
- master/fonte de maior fidelidade identificado;
- derivado gerado diretamente do master, sem recompressão lossy em cadeia;
- placement/bucket/key corretos;
- nenhuma dependência em conteúdo privado para superfície pública.

## Gate de qualidade antes de aceitar o derivado

- tamanho natural comparado ao maior tamanho real de exibição;
- `upscaleRatio` no eixo limitante calculado;
- até 1.15×: permitido após inspeção visual;
- entre 1.15× e 1.50×: exceção registrada e aprovada visualmente;
- acima de 1.50×: não promover; obter master melhor ou limitar a renderização;
- fullscreen/hero usa fonte adequada ao viewport, normalmente >=1600 px de largura e preferencialmente >=1920 px quando o master permite;
- personagem/portrait grande não é alimentado por thumbnail;
- crop/focal point não reduz o detalhe útil abaixo do necessário;
- alpha revisado em fundo claro e escuro;
- gradientes, rosto, cabelo, texto e textura fina sem banding/halo/blocos visíveis;
- comparação lado a lado com o master em 100% de zoom;
- tamanho do arquivo é o menor aprovado visualmente, não simplesmente o menor obtido.

## Contrato de entrega

- browser recebe um arquivo/objeto binário real;
- artwork principal não depende de `data:` URI;
- browser não baixa `.b64` nem concatena Base64;
- se Base64 foi necessário para transporte, ele foi materializado e validado antes de `next build`;
- imagem principal existe no HTML/React como URL real; placeholder não é dependência funcional;
- extensão, MIME, preload e bytes representam o mesmo formato;
- fallback aponta para outro recurso binário real;
- alias/compatibilidade tem propósito, MIME real e plano de remoção;
- objetos grandes/reutilizáveis usam placement R2; assets pequenos/code-coupled podem usar Git/runtime conforme política.

## Depois do upload

- objeto lido de volta;
- bytes/hash/MIME idênticos;
- dimensões do objeto publicado iguais às registradas;
- colisão inexistente;
- evidência salva sem secrets.

## Antes de promover mídia pública

- GET HTTPS anônimo real;
- status 200/206 e MIME esperados;
- decode concluído;
- hash/bytes/dimensões conferidos;
- consumer/runtime aceita o host/path;
- consumer não amplia a mídia além do gate aprovado;
- URL pública é final/canônica ou compatibilidade explicitamente justificada;
- nenhum redirect mascara erro do objeto final;
- fallback definido;
- rollback conhecido.

## Consumidores

- desktop 1080p, desktop 2K e mobile revisados quando suportados;
- `naturalWidth`/`naturalHeight` registrados no browser;
- `clientWidth`/`clientHeight` comparados à dimensão natural;
- imagem conferida em 100% de zoom, não apenas em screenshot reduzido;
- crop/focal point não perde conteúdo importante;
- `object-fit`/transform/zoom não introduzem upscale destrutivo;
- layers transparentes respeitam a resolução natural de cada subject;
- loading/erro não escondem informação principal;
- `next/image`/CDN não fazem segunda compressão desnecessária de um derivado final já otimizado;
- nenhum `requestfailed` em mídia crítica durante E2E;
- compartilhamento emite imagem da própria página quando elegível;
- nenhum consumidor reconstrói object key em paralelo.

## Cenas fullscreen/cinematográficas

- flattened/static artwork só é usado se passar o gate de resolução do fullscreen;
- uma variante 960×540 não pode ser usada como equivalente de 1920×1080 apenas por existir no bundle;
- se o static falhar e as layers tiverem melhor detalhe útil **sem alterar a direção visual aprovada**, podem ser usadas temporariamente;
- se a composição estática for obrigatória, produzir flattened master hi-res com o mesmo enquadramento;
- motion/scale não excede o orçamento de upscale da layer;
- cenas desktop e mobile são inspecionadas separadamente.

## Gate de release

- `pnpm check` verde;
- build verde;
- E2E abre a página real;
- imagens críticas terminam `complete` e decodificam com dimensões > 0;
- E2E reprova Base64/data URI onde o contrato exige URL binária;
- E2E reprova upscale acima do orçamento;
- Preview smoke testa as rotas de lore/media alteradas;
- Production staged smoke testa as mesmas rotas antes de promover domínio;
- canonical smoke repete os recursos críticos após promoção;
- HTTP 200 da homepage sozinho nunca é aceito como prova de mídia.

## Retirada

- nenhuma referência/fallback ativa;
- fora da janela de rollback;
- não é master/evidência necessária;
- retenção cumprida;
- delete explicitamente autorizado.
