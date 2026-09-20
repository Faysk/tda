# Media Storage — placement de binários

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-20
> Fonte de verdade: ADR-0018

## Regra principal

**Toda mídia que o produto decide persistir/publicar pertence ao Media Storage.**

Provider atual: Cloudflare R2.

### Público

`tda-media-public`:

- cover/hero/gallery;
- portraits/artwork;
- mapas;
- mídia de lore;
- social cards;
- assets de marca consumidos publicamente;
- áudio/vídeo que o produto decida publicar.

### Privado

`tda-media-private`:

- masters/originais;
- material editorial/review;
- fontes de geração;
- uploads ainda não aprovados;
- mídia sem audience pública explícita.

### Preview/staging

`tda-media-preview`:

- homologação;
- testes de upload;
- pending objects fora de Production;
- derivados temporários.

Preview não usa Production por conveniência.

### Local

Ficam locais quando não são artefatos persistidos/publicados do produto:

- áudio bruto de processamento;
- intermediários pesados;
- caches reconstituíveis;
- scratch temporário.

## Git

Git **não é storage de mídia**.

Ficam no repositório:

- código;
- HTML/CSS/JS;
- manifests;
- metadata;
- hashes/checksums;
- migrations;
- tooling;
- documentação;
- configuração declarativa não secreta.

## Compatibilidade atual

O repo ainda possui **73 artefatos de mídia** diretamente versionados no snapshot de 2026-09-20, incluindo arquivos normais e blobs base64.

Eles são dívida de migração/compatibilidade. Inventário: [Dívida de mídia ainda versionada no Git](../media-git-debt-2026-09-20.md).

Regras:

- não usar esses casos como precedente para mídia nova;
- **não adicionar novos bytes de mídia ao Git**;
- não apagar enquanto houver consumidor/bootstrap dependente;
- migrar com SHA/consumer/rollback conhecidos;
- após a migração, manter no Git apenas identidade/manifest/checksum necessários.

## Decisão

```text
é mídia persistida/publicada?
  não -> código/local/scratch conforme natureza
  sim ->
      homologação? -> preview
      público aprovado? -> public
      senão -> private
```

Em dúvida, usar o destino mais restritivo e promover depois.

## Limites

Media Storage não é banco, fila nem filesystem genérico.

Código continua no Git. Banco continua dono de identidades/relações/metadados. Media Storage é dono dos bytes de mídia.
