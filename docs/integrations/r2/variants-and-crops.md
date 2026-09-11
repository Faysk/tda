# R2 — variantes e crops

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-11

`cover`, `hero`, `portrait`, `artwork`, `gallery`, `social` e `original` são roles editoriais. Cover e hero são peças distintas, não apenas resoluções diferentes.

Não persistir thumbnail apenas para resizing quando o pipeline web já atende. Um derivado físico só deve existir por necessidade editorial, social, técnica ou de custo medida; ele recebe novo SHA/key e preserva provenance.

`object-fit: cover` pode cortar conteúdo. Centro só é default depois de revisão visual. Focal point, quando necessário, pertence ao vínculo/uso e não muda os bytes originais.

Fallback nunca usa mídia de outra sessão/entity: preferir outra role da mesma identidade quando fizer sentido; caso contrário usar placeholder oficial/DS. Falha da imagem não pode remover título, métricas ou ação.
