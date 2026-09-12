# R2 — variantes e crops

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-12

`cover`, `hero`, `portrait`, `artwork`, `gallery`, `social` e `original` são roles editoriais. Cover e hero são peças distintas, não apenas resoluções diferentes.

A prioridade do TDA é preservar qualidade visual perceptível. Redução de bytes é desejável, mas nunca deve transformar um asset editorial em uma imagem visivelmente borrada, blocada, serrilhada ou lavada quando exibida na superfície principal.

## Regra fundamental

O browser, `next/image`, AVIF/WebP ou qualquer CDN podem reduzir bytes e gerar variantes, mas não recriam detalhe que não existe no raster de origem. Um arquivo de baixa resolução não se torna um hero de alta resolução apenas porque o pipeline gerou uma variante com mais pixels.

Nunca usar upscale destrutivo como estratégia de publicação. Quando a fonte disponível ainda não atende ao uso, reduzir o tamanho de exibição é preferível a ampliar uma imagem visivelmente ruim até que um master adequado exista.

## Relação entre master, derivado e role

O master é a melhor fonte conhecida e deve ser preservado sem recompressões em cadeia. Todo derivado físico parte do master ou da fonte de maior fidelidade disponível; nunca de outro derivado lossy quando a fonte melhor existe.

Um derivado físico só deve existir por necessidade editorial, social, técnica ou de custo medida. Ele recebe novo SHA/key e preserva provenance, dimensões, encoder/parâmetros e vínculo com o master.

`next/image` e outros otimizadores web são mecanismos de entrega, não masters. Se a entrada do otimizador já for um AVIF/WebP final e pequeno, evitar uma segunda compressão lossy desnecessária. Para assets locais já preparados e muito leves, `unoptimized` pode ser preferível quando isso preserva fidelidade e não cria custo relevante de transferência.

## Contrato de entrega do browser

Mídia editorial deve chegar ao browser como um recurso de imagem normal e verificável:

`master -> derivado validado -> arquivo/objeto binário -> URL canônica -> browser`

Não usar como arquitetura permanente:

- Base64 ou `data:` URI para imagens editoriais grandes;
- arquivo textual `.b64` baixado pelo browser para reconstruir imagem;
- fragmentos Base64 concatenados em runtime;
- placeholder 1×1 que depende de JavaScript para descobrir a arte principal;
- alias cuja extensão declara um formato e cujo objeto final usa outro sem que a resposta HTTP exponha o MIME real;
- redirect como substituto de verificação de entrega.

Base64 pode existir somente como **formato de transporte/build input** quando uma ferramenta não consegue movimentar binário. Nesse caso ele deve ser decodificado e validado antes de `next build`; o artefato publicado e consumido pelo browser é sempre o arquivo binário real.

Para assets pequenos, code-coupled e estáveis, Git/runtime é aceitável. Para mídia pública editorial maior ou reutilizável, R2 público com custom domain é o caminho normal. A decisão de placement continua em `placement.md`; o consumidor não deve mudar a arquitetura por conveniência de tooling.

## Gate de resolução

A relação entre o tamanho natural do raster e o maior tamanho em que ele será realmente apresentado deve ser conhecida antes da promoção.

Use `upscaleRatio = tamanho_exibido / tamanho_natural` no eixo limitante.

- `<= 1.00`: ideal; sem upscale.
- `> 1.00 e <= 1.15`: tolerável para arte não técnica após inspeção visual.
- `> 1.15 e <= 1.50`: exceção; exige justificativa e validação visual explícita na superfície real.
- `> 1.50`: não promover como apresentação normal. Trocar o master/derivado ou limitar o tamanho de renderização.

Pixel art ou estética deliberadamente low-resolution são exceções editoriais, não precedentes para fotografia, ilustração ou personagem.

O hard floor acima usa CSS pixels no viewport-alvo principal. Para telas de alta densidade, considerar também DPR e nitidez esperada; se a superfície depende de detalhe fino, manter fonte 2x quando houver master suficiente.

## Pisos práticos por superfície

São referências de aceitação, não ordem para inventar pixels:

- fullscreen/hero de fundo: preferir 1920 px ou mais de largura; 1600 px é o piso normal para desktop quando o crop permite e a revisão visual aprova;
- personagem/portrait grande: preferir 1200–1600 px de largura útil ou 1400–2400 px de altura, conforme a composição;
- card/gallery editorial: menor lado útil de aproximadamente 600 px quando o card pode crescer em desktop;
- social large image: gerar na proporção final a partir de master suficiente, normalmente 1200×630 para 1.91:1;
- thumbnail pequeno pode ser menor, desde que nunca vire implicitamente o master de hero/card.

Se a fonte real estiver abaixo desses pisos, não fazer upscale apenas para satisfazer o número. Limitar o uso ao tamanho natural e registrar a necessidade de master melhor.

## Compressão

Qualidade é decidida por comparação visual, não pelo menor arquivo possível.

- Preferir AVIF para fotografia/ilustração opaca quando a decodificação e o tooling do consumidor forem adequados.
- Para transparência, testar AVIF e WebP sobre fundo claro e escuro; escolher o menor que preserve bordas sem halo, fringe ou banding.
- PNG permanece válido para master, line art, casos lossless ou quando alpha/artefatos justificarem.
- Nunca recomprimir repetidamente o mesmo lossy. Derivar novamente do master.
- Não perseguir um número universal de `quality`, CRF ou bytes. Encoders e conteúdos respondem de forma diferente.
- PSNR/SSIM podem apoiar comparação automatizada, mas não substituem inspeção humana em rostos, cabelo, texto, bordas com alpha, gradientes, céu/noite e textura fina.

O objetivo de compressão é: menor arquivo que seja visualmente indistinguível ou quase indistinguível do master na superfície-alvo.

## Extensão, MIME e URL

A extensão usada no contrato público deve representar o formato real sempre que possível. Se uma rota de compatibilidade conservar um nome legado, a resposta HTTP deve obrigatoriamente retornar o `Content-Type` real dos bytes e a migração para um nome coerente deve permanecer explícita.

Nunca declarar preload como `image/avif` quando o recurso efetivamente entregue é WebP. Preload, `src`, `Content-Type`, metadata e objeto canônico devem convergir para o mesmo formato.

Para R2, preferir URLs content-addressed/imutáveis no custom domain. Alteração de bytes gera nova key; cache longo fica associado à identidade do conteúdo, não a um nome mutável.

## Crops e focal points

`object-fit: cover` pode cortar conteúdo. Centro só é default depois de revisão visual. Focal point, quando necessário, pertence ao vínculo/uso e não muda os bytes originais.

Um crop não corrige falta de resolução. Calcular o tamanho útil **depois** do crop: se apenas 60% da largura do master entra no enquadramento, a largura útil para qualidade também cai.

Para composições em camadas, cada layer deve respeitar sua própria resolução natural. Um subject transparente de 600 px não deve ser renderizado a 900 px apenas porque o background aguenta fullscreen.

## Variantes estáticas e cenas cinematográficas

Flattened/static artwork é permitido quando a composição exata precisa ser congelada, mas a variante achatada deve passar o mesmo gate de resolução do uso final. Uma versão estática 960×540 não é substituto aceitável para uma cena fullscreen de aproximadamente 1920×1080.

Se a variante estática falhar no gate e background/subject separados tiverem maior detalhe útil, usar temporariamente a composição em camadas. Reativar o static apenas quando existir um flattened master que preserve a qualidade da superfície.

## Fallback de qualidade

Fallback nunca usa mídia de outra sessão/entity: preferir outra role da mesma identidade quando fizer sentido; caso contrário usar placeholder oficial/DS. Falha da imagem não pode remover título, métricas ou ação.

Baixa resolução também é um tipo de incompatibilidade. Se a única mídia disponível não aguenta o slot, o consumidor deve reduzir o slot, usar uma role apropriada da mesma identidade ou cair no fallback oficial; nunca inflar silenciosamente um thumbnail.

Fallback não deve exigir reconstrução de bytes no browser. Ele aponta para outro recurso binário já materializado e verificável.

## Aceite visual obrigatório

Antes de promover um novo master/derivado para uma superfície importante, revisar pelo menos:

- viewport desktop alvo;
- viewport mobile alvo;
- crop/focal point real;
- 100% de zoom, sem screenshot reduzido escondendo artefatos;
- bordas com alpha em fundos claros e escuros;
- textura fina/rosto/cabelo quando aplicável;
- comparação lado a lado com o master;
- peso final e número de requests;
- `naturalWidth`/`naturalHeight` do recurso realmente carregado;
- `clientWidth`/`clientHeight` na superfície real;
- ausência de `data:`/Base64 em mídia editorial publicada;
- decode real no browser e ausência de request failed.

CI verde só vale como gate de mídia quando executa essas verificações. Build/HTTP 200 isolados não provam qualidade visual nem entrega correta.
