# Estatísticas privadas de transcrições

> Status: read model bounded versionado; rollout e benchmark Production V2 pendentes
> Owner: transcrições / leitura e estatísticas
> Última revisão: 2026-09-23
> Fonte de verdade: `src/features/transcripts/statistics`, `public.sessions`, `public.transcript_segments` e `public.transcript_session_statistics`

## Superfície e conjunto

`/transcricoes` mostra totais e métricas por sessão, com entrada em Minha conta para leitores. `?campanha=slug` escolhe uma campanha; o default é `yuhara-main`. O cabeçalho identifica explicitamente esse conjunto. Não agrega campanhas não selecionadas e não usa a lista pública de publicações nem o limite de 250 sessões do Edit temporário.

Todas as sessões da campanha autorizada entram no conjunto, inclusive sem transcrição. A paginação interna por UUID percorre somente `sessions`; para cada página de até 200 sessões, a aplicação lê no máximo uma linha agregada por sessão em `transcript_session_statistics`. O custo de render deixa de depender do número total de `transcript_segments`. A tela mostra todo o conjunto autorizado, sem filtro/página client-side. Se qualquer página de sessão ou lote agregado falhar, retorna indisponibilidade, nunca um total parcial silencioso.

## Métricas canônicas

| Métrica | Fonte e regra |
| --- | --- |
| Palavras | O read model mantém `word_count` transacionalmente a partir de `transcript_segments.text`, sem confiar no `text_words` histórico. A função SQL espelha `countTranscriptWords` do Edit, incluindo whitespace Unicode ECMAScript. `Olá, ação!` = 2; `d'água` = 1; `guarda-chuva` = 1; `... —` = 2 tokens. É contagem operacional de tokens separados por espaço, não análise linguística. |
| Revisões | `revision` atualiza a mesma linha; não somar `audit_log`, respostas alternativas, `transcription_cache`, publicações, classificações ou summaries. Preserva o conjunto da leitura atual do Edit, inclusive estados `discarded`: status de revisão não cria outra versão nem elimina o texto da leitura. |
| Identidade | PK `id`, com índice UNIQUE parcial `(session_id, source_segment_id)` existente. A coleta rejeita source ID repetido na mesma sessão; nunca deduplica pelo texto, pois falas iguais podem ser legítimas. Source ID nulo mantém a identidade pela PK, sem inferir equivalência. |
| Duração registrada | `sessions.duration_ms`, inteiro em **milissegundos**, finito e não negativo. Sem fallback para `end_ms`, soma de tracks, `recording_files`, fala/VAD, started/ended ou tempo de leitura. |
| Ausência | Sem segmentos = palavras não informadas; texto presente vazio = 0; texto nulo torna a contagem da sessão não informada. Duração nula/inválida = não informada; zero explicitamente registrado permanece 0. |
| Totais | Soma dos valores conhecidos, acompanhada por cobertura separada de palavras e duração (`N de M sessões`). Sem nenhum valor conhecido, total não informado. Cobertura incompleta tem aviso visível. Milissegundos são somados antes da formatação. |
| Exibição | Português, separador de milhar pt-BR, duração `h`/`min`, truncada ao minuto completo; valores positivos menores que 1 min são explicitados. |

Não se afirma que toda duração histórica seja a duração real da gravação: a origem do preenchimento pode ter usado o fim transcrito. Por isso o rótulo é **duração registrada**. A retificação da proveniência/duração real pertence à importação/dados, sem backfill nesta entrega.

## Autorização e cache

O único entrypoint da página é `getTranscriptStatistics`. Ele chama `authorizeCampaignCapabilityServer` com `campaign.transcript.read` e o slug selecionado **antes** da coleta. Reutiliza Auth verificado, profile, grants ativos/temporais e capability/scope do [contrato de identidade](../domains/identity-access.md). Login sozinho não basta; leitura não exige edição/admin. Grants somente de session/resource não são promovidos implicitamente a campaign: ficam negados pelo resolver atual.

O repository é interno e server-only, com o mesmo `editDataClient` privilegiado do [slice de leitura](edit-transcript-server-slice.md). A autorização é da aplicação; não se afirma enforcement RBAC nativo por RLS, pois a credencial server-side possui bypass. Cada consulta de sessões filtra `campaigns.slug`; cada lote de `transcript_session_statistics` recebe apenas IDs da página autorizada e também faz join até `sessions -> campaigns.slug`. O collector rejeita aggregate de sessão não solicitada, duplicado ou estruturalmente inválido. A tabela agregada tem RLS habilitado, nenhum grant para browser e `SELECT` somente para `service_role`.

O browser recebe somente título/data e métricas autorizadas. O caminho de leitura de Stats não lê nem serializa texto de transcrição; recebe apenas contadores agregados por sessão. Não há API pública de estatísticas nem métricas em metadata/páginas públicas. A rota é dinâmica, força fetch sem cache e participa do proxy `private, no-store` / `noindex, nofollow`. Não existe cache persistente de resultados/autorização.

## Atualização e limites operacionais

`transcript_session_statistics` é mantida por trigger `AFTER INSERT/UPDATE OF session_id,text/DELETE` em `transcript_segments`. INSERT/import, edição, remoção e mudança de sessão aplicam deltas na mesma transação; `text_words` não é usado como fonte do agregado. Uma migration faz backfill inicial sob lock de escrita da tabela de segmentos, evitando snapshot parcialmente concorrente. Sessão sem segmentos não mantém row agregada; texto nulo reduz cobertura e texto vazio informado conta como zero palavras.

A leitura usa páginas de até 200 sessões e, por página, no máximo um lote de aggregates para os mesmos IDs. Assim, o fan-out é O(sessões) e independente do volume de segmentos. A página continua instruindo recarregar após editar/importar; não promete atualização ao vivo de uma aba já aberta.

### Observabilidade operacional

`TDA_STATS_READ_MODEL_V2_ENABLED` é `false` por default. Enquanto estiver desabilitada, a aplicação preserva exatamente o caminho V1 e a telemetria `TDA_STATS_READ_V1`; isso permite merge/deploy do código antes da migration sem consultar uma tabela inexistente. O rollout correto é migration + read-back de tabela/grants/trigger -> habilitar flag em Production -> benchmark -> manter/rollback pela flag.

A leitura bounded emite no runtime server-side o evento sanitizado `TDA_STATS_READ_V2`. Ele registra somente outcome, duração total, quantidade de requests/rows de sessões e aggregates e tamanho UTF-8 aproximado dos payloads. Não registra campaign slug, usuário/profile, IDs de sessão, texto de transcrição, detalhes de erro ou credenciais. O benchmark V2 deve ser comparado à baseline V1 confirmada em Production em 2026-09-23: mediana 15,39 s, 30.857 segmentos e 49 requests de segmentos por leitura.


Não há snapshot transacional entre páginas: importação/edição simultânea pode produzir uma leitura durante a mudança. Recarregar após a operação concluída é o contrato atual. Falha de rede/cursor/identidade ambígua nega o resultado integral, sem reaproveitar contagem antiga de outro usuário.

## Referência histórica revalidada

Checkout `D:/Projects/dnd` e `Faysk/dnd-scribe@main` conferidos no mesmo SHA `fa22c1de01e899d3956e6a0d2167bdbffa816db4`:

- [publication.py](https://github.com/Faysk/dnd-scribe/blob/fa22c1de01e899d3956e6a0d2167bdbffa816db4/local-companion/app/publication.py): maior `end` dos segmentos em segundos; não comprova duração da gravação.
- [transcriber.py](https://github.com/Faysk/dnd-scribe/blob/fa22c1de01e899d3956e6a0d2167bdbffa816db4/local-companion/app/transcriber.py): maior duração das faixas alinhadas como duração de sessão; soma separada representa trabalho de áudio.
- [formatters.ts](https://github.com/Faysk/dnd-scribe/blob/fa22c1de01e899d3956e6a0d2167bdbffa816db4/apps/web/lib/formatters.ts): recebe milissegundos, arredondava minutos e tratava zero como ausente; o reboot distingue zero informado de ausência.
- API antiga `api/[...path].js` somava `text_words` dos segmentos. Não reutilizado como fonte confiável: a contagem atual lê texto e a função canônica do Edit.

Inspeção read-only do Supabase canônico em 2026-09-07 confirmou tipos de colunas e índice único. Nenhum texto privado foi extraído nessa inspeção; nenhum dado/schema foi escrito. Ver [catálogo físico](../database/schema-catalog.md) e [segurança](../database/security.md).

## Critérios de aceite e reprodução

- `src/features/transcripts/statistics/*.test.ts`: tokens vazios/acentos/pontuação; ausências/zero; duração sobreposta; source duplicado; sessão divergente; paginação de sessões e segmentos; falha tardia/cursor repetido; autorização antes da consulta; revogação sem resultado reaproveitado.
- `playwright.statistics.config.ts` + `tests/statistics`: Next de produção local com endpoints Auth/PostgREST **sintéticos**, 205 segmentos, paginação artificial menor que o solicitado, campanha diferente e leitor sem edição. Verifica HTML/RSC sem texto, anônimo/sem grants negados, no-store, totais completos, cobertura, atualização no reload, desktop/mobile sem overflow e captura de tela.
- `pnpm check`, `pnpm build`, `pnpm test:e2e` (suíte habitual e suíte estatísticas). O provedor sintético escuta somente loopback; não injeta bypass na aplicação e não usa credenciais reais.
- CI deve terminar verde no SHA final da PR. Isso não significa publicação, login Discord real ou validação de políticas PostgREST/RLS de produção.

## Dependências e rollback

Validação local concluída em 2026-09-07: `pnpm check` (173 Vitest + 24 testes Node), build otimizado, 75 testes E2E habituais e 8 E2E de estatísticas passaram. Capturas de desktop 1440px e mobile 390px inspecionadas, sem overflow/erro de página. A suíte habitual usou porta local isolada 3117 porque 3101 já estava ocupada por outro processo; nenhum processo alheio foi encerrado. CI permanece gate separado do commit final.

Base sincronizada com `main@5f6be2e`, incluindo Auth #48. Não alterar permissões para fazer os testes passarem. Configuração real de Auth/claim e o fluxo de edição continuam com seus donos. Login OAuth real não foi exercitado nesta entrega.

Rollback de aplicação: retirar a rota/link/matcher e os módulos de estatísticas. Sem schema/dados a reverter. Não houve merge, deploy, DDL ou mutation de produção nesta rodada.
