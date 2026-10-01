# R2 — identidade e object keys

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-10-01

## Quatro identidades

Cada mídia mantém separadas:

1. owner de domínio — `campaigns.id` quando a mídia é campaign-owned;
2. identidade estável de storage — `campaigns.slug` como `campaignMediaKey`, nunca `name` nem `public_slug`;
3. recurso/role — UUID canônico da sessão/entity/campaign e `cover`, `hero`, `portrait`, `artwork`, `gallery` ou `social`;
4. conteúdo — SHA-256 dos bytes;
5. endereço — bucket + object key + URL, se pública.

URL pública não é identidade permanente. `sourceSessionId` pode ser necessário para rota/provenance, mas não substitui o UUID canônico.

## Keys canônicas

```text
campaigns/{campaignMediaKey}/campaign/cover/{sha256}.{ext}

campaigns/{campaignMediaKey}/sessions/{uuid}/cover/{sha256}.{ext}
campaigns/{campaignMediaKey}/sessions/{uuid}/hero/{sha256}.{ext}
campaigns/{campaignMediaKey}/sessions/{uuid}/gallery/{sha256}.{ext}
campaigns/{campaignMediaKey}/sessions/{uuid}/social/{sha256}.{ext}

campaigns/{campaignMediaKey}/entities/{uuid}/portrait/{sha256}.{ext}
campaigns/{campaignMediaKey}/entities/{uuid}/artwork/{sha256}.{ext}
campaigns/{campaignMediaKey}/entities/{uuid}/gallery/{sha256}.{ext}
campaigns/{campaignMediaKey}/entities/{uuid}/social/{sha256}.{ext}

site/social/{name}/{sha256}.{ext}
site/shared/{name}/{sha256}.{ext}
```

O `campaignMediaKey` é o technical slug estável de `campaigns.slug`. Rename editorial ou de `public_slug` não move bytes, não muda key e não exige cópia. O namespace legado `campaigns/yuhara-main/...` continua válido e servível; não existe migração estética de objetos.

Lore standalone sem entity UUID confirmado usa `lore/{stableId}/{sha256}/{filename}` e continua independente de campaign. Vincular editorialmente uma lore a uma campaign não move seus bytes automaticamente. Lembra permanece biblioteca global; `campaign_id` ali é classificação opcional e também não move objeto. Demos técnicas usam namespace `demos/...` separado e não viram canon.

## Metadados mínimos

Preservar evidência de bucket, key, SHA-256, MIME real, bytes, dimensões, provenance, audience, identidade relacionada, role e timestamps de preparação/verificação. Consumidores não devem reconstruir keys manualmente quando houver resolvedor de mídia.

## Binding e isolamento

O caminho físico não substitui ownership relacional. `media_assets.campaign_id` prova o owner; bindings semânticos usam FKs compostas com a mesma campaign. Para campaign cover/card, `campaign_media_bindings(campaign_id, role, asset_id)` impede A de apontar para asset de B. Consumidores públicos só resolvem URLs depois de `read_back_verified` e, quando pública, `public_delivery_verified`.

Staging/finalize resolvem a campaign no servidor a partir do recurso ou lease autorizado. Campaign enviada pelo browser nunca é autoridade. Cache/idempotency campaign-owned inclui owner + `campaignMediaKey` + recurso/role para que IDs iguais em A e B não colidam.
