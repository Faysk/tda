# API pública de resumos de sessões (v1)

Somente leitura, sem token, para conteúdo editorial explicitamente publicado. **Nunca** fornece transcrições, áudio, drafts, notas privadas, participants ou métricas privadas. A visibilidade segue o mesmo repositório server-only das páginas públicas, incluindo `published`, campanhas `active/public` e compatibilidade legada estrita.

## Endpoints

- `GET /api/public/sessions` — metadados e resumos curtos, ordenados pelo arquivo público. Query opcional `campaign=<publicSlug>`, `limit=1..100` (padrão 50), `offset=0..999999` (padrão 0).
- `GET /api/public/sessions/{campaign}/{sessionId}` — uma sessão publicada da campanha, incluindo `summaryFull` em Markdown (pode ser vazio se não houver texto publicado).

Exemplos:

```bash
curl -i 'https://dnd.faysk.dev/api/public/sessions?limit=10'
curl -i 'https://dnd.faysk.dev/api/public/sessions/cronicas-da-mesa/ID_DA_SESSAO'
```

Resposta da listagem: `{ "data": [...], "pagination": { "offset": 0, "limit": 10, "total": 13, "hasMore": true } }`. `total` é ilustrativo. Cada item contém `id`, `campaign: { slug, name }`, `title`, `date`, `arc`, `summaryShort`, `coverImage`, `heroImage`, `url`. O detalhe possui os mesmos campos, mais `summaryFull` e `format: "markdown"`. Imagens ausentes são `null`.

Erros JSON: `400 invalid_query` (somente listagem), `404 not_found` (detalhe não publicado/inexistente), `503 service_unavailable` (dependência). Não inclui diagnóstico interno. Respostas de sucesso possuem cache partilhado de 60 segundos; erros não são armazenados.

## Integração

Consumidores devem seguir `pagination.hasMore` e identificar sessões por `campaign.slug + id`, não apenas por `id`. `summaryShort` serve para cartões; `summaryFull` só está no detalhe. O API não concede leitura de campanhas privadas, não exige login e não disponibiliza CORS cross-origin para browsers de terceiros por defeito; servidores/CLIs podem consumir diretamente. Uma futura necessidade de browser cross-origin exige revisão específica de política de origens.

Nota de performance: a paginação HTTP é aplicada depois da leitura server-side do arquivo existente; evoluir para paginação no banco se o volume ou tráfego crescer.


## Proposta futura — aparições narrativas confirmadas (#1807)

A API v1 continua **sem dados de participantes**, transcrições, perfis ou menções. `participants.character_entity_id` é um vínculo operacional e **não é prova de aparição narrativa**.

O contrato de projeção de segurança em `src/features/sessions/character-appearances.ts` foi preparado para uma fonte editorial **ainda não implementada**. Só depois de existir seleção/revisão explícita e persistência da mesma versão publicada será possível acrescentar, de forma aditiva, `characterAppearances: [{ publicRef: string }]` aos resumos públicos.

O modelo previsto é:

- Lista de entidades PC/NPC escolhida e confirmada por editor autorizado por **campanha + sessão**, com revisão versionada da publicação. Não derivar de `entity_mentions`, texto da transcrição, `summaryFull` ou participante operacional.
- Projeção anônima fail-closed: sessão `published`, campanha `active/public`, identidade `public_web`, referência pública **explicitamente aprovada** (nunca inferir diretamente de um `entity.slug` que pode ser secreto).
- A representação externa **não contém IDs internos, nomes ocultos, perfis, aliases privados ou status de transcrições**. Vínculos `private_master`, `private_players`, `public_campaign` e `review_only` não saem pelo endpoint público.
- Ausência de campo ou lista vazia significa **sem dados públicos confirmados**, não comprova ausência de personagens na sessão. Consumidores não devem sintetizar presenças a partir do texto.
- Cache, republicação, despublicação e remoção de vínculos precisam preservar a fronteira de autorização; até a implementação completa, o contrato público existente não muda.

Ver [issue #1807](https://github.com/Faysk/tda/issues/1807) para a implementação editorial e os testes de autorização necessários antes de expor o campo.
