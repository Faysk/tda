# Estatísticas privadas de transcrições

> Status: implementado e publicado em Production; leitura privada por capability
> Owner: transcrições / leitura e estatísticas
> Última revisão: 2026-09-20
> Fonte de verdade: `src/features/transcripts/statistics` e `public.sessions` / `public.transcript_segments`

## Superfície e conjunto

`/transcricoes` mostra totais e métricas por sessão, com entrada em Minha conta para leitores. `?campanha=slug` escolhe uma campanha; o default é `yuhara-main`. O cabeçalho identifica explicitamente esse conjunto. Não agrega campanhas não selecionadas e não usa a lista pública de publicações nem o limite de 250 sessões do Edit temporário.

Todas as sessões da campanha autorizada entram no conjunto, inclusive sem transcrição. A paginação interna por UUID percorre todas as sessões e todos os segmentos até uma página vazia; limites do gateway menores que o solicitado não encerram a coleta. A tela mostra todo esse conjunto, sem filtro/página client-side. Se a leitura falhar em qualquer página, retorna indisponibilidade, nunca um total parcial silencioso.

## Métricas canônicas

| Métrica | Fonte e regra |
| --- | --- |
| Palavras | `transcript_segments.text` atual, uma vez por linha canônica. Usa `countTranscriptWords` do Edit: trim e separação por whitespace Unicode. `Olá, ação!` = 2; `d'água` = 1; `guarda-chuva` = 1; `... —` = 2 tokens. É contagem operacional de tokens separados por espaço, não análise linguística. |
| Revisões | `revision` atualiza a mesma linha; não somar `audit_log`, respostas alternativas, `transcription_cache`, publicações, classificações ou summaries. Preserva o conjunto da leitura atual do Edit, inclusive estados `discarded`: status de revisão não cria outra versão nem elimina o texto da leitura. |
| Identidade | PK `id`, com índice UNIQUE parcial `(session_id, source_segment_id)` existente. A coleta rejeita source ID repetido na mesma sessão; nunca deduplica pelo texto, pois falas iguais podem ser legítimas. Source ID nulo mantém a identidade pela PK, sem inferir equivalência. |
| Duração registrada | `sessions.duration_ms`, inteiro em **milissegundos**, finito e não negativo. Sem fallback para `end_ms`, soma de tracks, `recording_files`, fala/VAD, started/ended ou tempo de leitura. |
| Ausência | Sem segmentos = palavras não informadas; texto presente vazio = 0; texto nulo torna a contagem da sessão não informada. Duração nula/inválida = não informada; zero explicitamente registrado permanece 0. |
| Totais | Soma dos valores conhecidos, acompanhada por cobertura separada de palavras e duração (`N de M sessões`). Sem nenhum valor conhecido, total não informado. Cobertura incompleta tem aviso visível. Milissegundos são somados antes da formatação. |
| Exibição | Português, separador de milhar pt-BR, duração `h`/`min`, truncada ao minuto completo; valores positivos menores que 1 min são explicitados. |

Não se afirma que toda duração histórica seja a duração real da gravação: a origem do preenchimento pode ter usado o fim transcrito. Por isso o rótulo é **duração registrada**. A retificação da proveniência/duração real pertence à importação/dados, sem backfill nesta entrega.

## Autorização e cache

O único entrypoint da página é `getTranscriptStatistics`. Ele chama `authorizeCampaignCapabilityServer` com `campaign.transcript.read` e o slug selecionado **antes** da coleta. Reutiliza Auth verificado, profile, grants ativos/temporais e capability/scope do [contrato de identidade](../domains/identity-access.md). Login sozinho não basta; leitura não exige edição/admin. Grants somente de session/resource não são promovidos implicitamente a campaign: ficam negados pelo resolver atual.

O repository é interno e server-only, com o mesmo `editDataClient` privilegiado do [slice de leitura](edit-transcript-server-slice.md). A autorização é da aplicação; não se afirma enforcement RBAC nativo por RLS, pois a credencial server-side possui bypass. Cada consulta de sessões filtra `campaigns.slug`; cada consulta de segmentos exige session ID **e** join até a campanha. O collector também rejeita session ID divergente. Não cria RPC, policy, grant, migration ou segundo resolver.

O browser recebe somente título/data e métricas autorizadas. Texto de transcrição é lido em páginas estreitas apenas no servidor, contado e descartado. Não há API pública de estatísticas nem métricas em metadata/páginas públicas. A rota é dinâmica, força fetch sem cache e participa do proxy `private, no-store` / `noindex, nofollow`. Não existe cache persistente de resultados/autorização.

## Atualização e limites operacionais

Edição/importação altera as fontes canônicas; a próxima consulta/reload recalcula os valores, inclusive quando `text_words` derivado estiver desatualizado. A página instrui recarregar após editar/importar. Não promete atualização ao vivo de uma aba já aberta, nem depende da aplicação da RPC #44.

A leitura usa páginas de até 200 sessões e 1000 segmentos, sem nova dependência ou custo contratado. O custo é O(segmentos), com round trips por página/sessão. O ensaio sintético não é benchmark do Supabase real; medir latência/egress antes de expandir o volume. Uma agregação SQL futura exige contrato/migration revisada com o dono do banco, não habilitação automática de agregações públicas.

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
- CI continua sendo gate por mudança, mas a entrega inicial já foi integrada pela #64 e publicada na Production #006. O recibo operacional registrou OAuth real, renderização das estatísticas para usuário autorizado e negação após logout; isso não transforma a leitura server-side em enforcement RLS nativo.

## Dependências e rollback

Validação local concluída em 2026-09-07: `pnpm check` (173 Vitest + 24 testes Node), build otimizado, 75 testes E2E habituais e 8 E2E de estatísticas passaram. Capturas de desktop 1440px e mobile 390px inspecionadas, sem overflow/erro de página. A suíte habitual usou porta local isolada 3117 porque 3101 já estava ocupada por outro processo; nenhum processo alheio foi encerrado. CI permanece gate separado do commit final.

A evidência acima descreve a validação local histórica da implementação. Depois disso, a feature foi integrada na #64 e publicada na Production #006 (`7dd4b06d1a246ad924230530c2a0424e830aa46d`): OAuth real reconheceu a conta, `/transcricoes` renderizou sessões/totais com o aviso de duração ausente, e após logout a rota negou acesso sem expor métricas.

Rollback de aplicação continua simples: retirar rota/link/matcher e módulos de estatísticas em nova release. A feature não introduziu schema próprio nem mutation de dados.
