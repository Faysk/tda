# R2 — identidade e object keys

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-11

## Quatro identidades

Cada mídia mantém separadas:

1. identidade de domínio — UUID canônico da sessão/entity ou `stableId` editorial;
2. role — `cover`, `hero`, `portrait`, `artwork`, `gallery`, `social`;
3. conteúdo — SHA-256 dos bytes;
4. endereço — bucket + object key + URL, se pública.

URL pública não é identidade permanente. `sourceSessionId` pode ser necessário para rota/provenance, mas não substitui o UUID canônico.

## Keys canônicas

```text
campaigns/{campaign}/sessions/{uuid}/cover/{sha256}.{ext}
campaigns/{campaign}/sessions/{uuid}/hero/{sha256}.{ext}
campaigns/{campaign}/sessions/{uuid}/gallery/{sha256}.{ext}
campaigns/{campaign}/sessions/{uuid}/social/{sha256}.{ext}

campaigns/{campaign}/entities/{uuid}/portrait/{sha256}.{ext}
campaigns/{campaign}/entities/{uuid}/artwork/{sha256}.{ext}
campaigns/{campaign}/entities/{uuid}/gallery/{sha256}.{ext}
campaigns/{campaign}/entities/{uuid}/social/{sha256}.{ext}

site/social/{name}/{sha256}.{ext}
site/shared/{name}/{sha256}.{ext}
```

Lore sem entity UUID confirmado usa `lore/{stableId}/{sha256}/{filename}`. Demos técnicas usam namespace `demos/...` separado e não viram canon.

## Metadados mínimos

Preservar evidência de bucket, key, SHA-256, MIME real, bytes, dimensões, provenance, audience, identidade relacionada, role e timestamps de preparação/verificação. Consumidores não devem reconstruir keys manualmente quando houver resolvedor de mídia.
