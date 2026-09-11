# R2 — placement de binários

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-11

## Regra principal

- **Git/runtime**: assets pequenos e críticos acoplados ao código — favicon, ícones/SVGs oficiais, PWA/manifest e fallbacks do shell.
- **`tda-media-public`**: mídia com audience pública aprovada — cover/hero/gallery de sessão, retrato/artwork/gallery de entity, mapas, lore pública e derivados sociais/raster aprovados.
- **`tda-media-private`**: originals/masters não públicos, uploads pendentes, material editorial/review, fontes de geração e qualquer binário sem audience pública explícita.
- **`tda-media-preview`**: homologação, testes e objetos temporários. Preview não usa Production por conveniência.
- **local/companion**: áudio bruto, intermediários pesados e caches reconstituíveis.

## Decisão

```text
asset crítico pequeno? -> Git/runtime
precisa cloud?          -> não: local
público aprovado?       -> sim: public
homologação?            -> sim: preview
senão                   -> private
```

Em dúvida, usar o destino mais restritivo e promover depois.

## Limites

R2 não é filesystem genérico, banco, fila nem substituto do Git. CSS, JS, HTML e código ficam no repositório. Áudio bruto não vira requisito de cloud.
