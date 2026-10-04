# Campanhas, sessões e participantes

> Status: implementado
> Owner: sessions
> Última revisão: 2026-10-03

## Objetivo

Modelar a campanha e cada sessão sem confundir:

- identidade persistente de pessoa/personagem;
- ocorrência numa sessão;
- arquivos capturados;
- lifecycle editorial/processamento.

## Campaign

Campaign é boundary de dados narrativos. O runtime legado/default usa o technical slug `yuhara-main`, cuja apresentação pública planejada é **Crônicas da Mesa**. ADR-0020 define a evolução para múltiplas campaigns first-class.

Identidade:

- UUID é autoridade relacional;
- technical slug é compatibilidade e não muda por rename editorial;
- nome público e public route key são apresentação;
- lifecycle mínimo é `active | archived`, separado de discovery/visibilidade.

Onde query/ação pertence a uma campaign, o boundary é explícito. `source_session_id` não é identificador global: dois registros em campaigns diferentes podem legitimamente compartilhar o mesmo source ID se as constraints físicas do domínio permitirem.

A segunda campaign planejada **Antes que seja tarde** começa apenas com identidade/metadata aprovada. Não criar session, participant, entity, canon ou publication fictícios para “preencher” a campaign.

## Session

Palavras e duração registrada para leitores de transcrições seguem o [contrato de estatísticas privadas](../features/transcript-statistics.md), incluindo unidade, ausências e cobertura dos totais.

Uma session agrega:

- data/título/arco;
- lifecycle operacional/editorial;
- participantes;
- fontes/arquivos;
- transcrição/eventos;
- candidatos/revisão;
- publicações.

### Lifecycle atual

```text
planned
  -> recording
  -> uploaded
  -> processing
  -> ready_for_review
  -> reviewing
  -> approved
  -> published
  -> archived
```

`failed` pode representar falha operacional. Nem toda transição precisa ser automática; UI futura deve impedir saltos inválidos conforme contrato do caso de uso.

### Consentimento

`sessions.consent_confirmed` existe. Antes de construir superfícies de bastidores/publicação de áudio, definir de forma explícita o que esse flag garante e o que ainda exige aprovação individual (outtakes já têm controles próprios).

## IDs e provenance

- `sessions.id`: UUID interno;
- `source_session_id`: identificador de origem/legado quando aplicável;
- `source_system`: provenance.

URLs públicas atuais podem usar `sourceSessionId` por compatibilidade, mas isso não muda a identidade interna.

## Participant

Participant é ocorrência por session.

Pode representar:

- jogador conhecido + PC conhecido;
- jogador conhecido + personagem textual ainda não resolvido;
- personagem conhecido sem vínculo humano histórico;
- convidado;
- DM/track operacional.

Campos de `profile_id` e `character_entity_id` resolvem dimensões diferentes.

### Regra de resolução

Nunca preencher `profile_id` apenas porque `character_name` bate com um PC se o histórico não prova qual conta participou daquele registro.

É permitido resolver `character_entity_id` quando a identidade narrativa é inequívoca e preservar profile nulo.

### Reconciliação entre recording parts

No fluxo local multi-recording, participant mapping reconcilia observações de tracks dentro de uma session sem transformar identidade operacional em identity global.

- `source_id + track_number` identifica a observação local, não a pessoa;
- Discord ID preservado pelo Craig pode sustentar match forte dentro da session;
- label/username é evidência auxiliar;
- ambiguity permanece explícita e pode exigir confirmação manual;
- guest continua representável com `profile_id = null`;
- nenhum match textual cria profile;
- decisões manuais e o hash do mapping pertencem à composition/review e não reescrevem runs brutos.

## Participantes históricos atuais

O alinhamento de 2026-09-06 conectou 12 aparições de Astel/Dandelion/Screacky às suas entities. Apenas os vínculos humanos já conhecidos foram preservados; nenhuma pessoa foi inferida artificialmente.

## Arquivos

`recording_files` registra fontes da session e pode ligar track a participant. É provenance/catálogo de entrada, não autorização de download.

Tipos históricos incluem Craig, Roll20, Discord, notas, transcript e derivados.

## Eventos e markers

`roll20_events`, `session_markers`, `discord_interactions` e `table_notes` enriquecem a timeline da sessão. Eles permanecem fontes ou intenção de revisão.

## Publicação da session

Uma session `published` pode ter múltiplas publications. O status da session não significa que todo artefato/candidato daquela session é público.

Exemplo:

- recap público: permitido;
- transcript: privado;
- outtake sensitive: continua privado;
- master note: privado;
- canon entry: audience própria.

### Arquivos públicos multi-campanha\n\nA rota canônica agregada é `/campanhas/sessoes`; `/campanhas/[campaign]/sessoes` restringe a uma campanha e `/campanhas/[campaign]/sessoes/[sourceSessionId]` identifica o detalhe por campanha + source ID. `/sessoes` é alias de compatibilidade do agregado e `/sessoes/[sourceSessionId]` só redireciona quando a resolução legada é inequívoca.\n\nNo agregado, arcos homônimos contam separadamente por campanha. O repository pagina server-side em lotes explícitos e não impõe teto silencioso de 500 registros. Enquanto o candidate #1123 não estiver aplicado, o fallback de compatibilidade só permite a campanha histórica; nenhuma campanha nova é inferida como pública.

A identidade usada por contagem e filtros de arco é compartilhada: remove apenas espaços externos, normaliza Unicode para NFC e compara caixa em `pt-BR`. A grafia editorial original continua sendo o texto exibido; acentos não são removidos e não existe fuzzy merge entre nomes diferentes, como `Thalindra` e `Talindra`. No arquivo agregado, a identidade também inclui a campaign, portanto arcos com o mesmo título em campaigns diferentes permanecem separados e são desambiguados no filtro quando necessário.\n\n### Arquivo público legado `/sessoes`

O arquivo público pode compor e agregar somente campos que já pertencem ao contrato publicado da session, hoje:

- `source_session_id` usado pela URL pública;
- título;
- data;
- arco;
- resumo curto;
- artwork pública elegível;
- estado `published` e boundary da campanha.

Totais exibidos no hero do arquivo podem derivar desses próprios campos, como quantidade de memórias publicadas, quantidade de arcos e intervalo de datas.

Não promover para `/sessoes` métricas que pertencem ao leitor privado de transcrições. Em especial, palavras, duração registrada e participações não viram públicas apenas porque podem ser agregadas sem mostrar o texto bruto. Uma futura mudança de audience para essas métricas precisa ser decisão explícita de produto/domínio, com contrato e revisão de segurança próprios.

O repository público continua server-only e estreito; não deve consultar transcrições ou perfis para enriquecer cards públicos.

### Limites de leitura dos consumidores públicos

O arquivo completo e os consumidores de destaque possuem contratos de leitura diferentes:

- o arquivo público continua usando paginação server-side em lotes de 200 e pode percorrer todas as sessões publicadas quando a própria tela precisa do conjunto completo;
- a Home usa uma leitura dedicada e ordenada no servidor, limitada a **5 registros de conteúdo**: 1 sessão em destaque + 4 memórias recentes;
- a ordem limitada da Home preserva `session_date DESC NULLS LAST`, depois campaign pública e `source_session_id`, mantendo determinismo quando duas campanhas compartilham o mesmo source ID;
- o detalhe busca a sessão atual por `campaign + source_session_id` e resolve anterior/próxima por probes limitados a 1 registro cada; ele não carrega o arquivo inteiro para montar a navegação;
- datas ausentes permanecem no fim do arquivo e os probes de vizinhança tratam explicitamente a transição entre sessões datadas e sem data;
- esses limites são de consulta, não um cache global: não introduzem Redis, novo provider, novo tier nem mudança de persistência.

A regressão de performance deve medir separadamente quantidade de requests e registros transferidos. No schema canônico com registry de campanhas disponível, a Home usa 1 request de dados / no máximo 5 registros independentemente de o arquivo possuir 13, 200 ou 1.000 sessões. Enquanto um ambiente ainda exigir o fallback de schema legado, há um probe moderno que retorna erro de compatibilidade e então 1 request de dados legado; portanto são 2 requests HTTP no total, mas continuam no máximo 5 registros de conteúdo transferidos. Para a navegação de detalhe, cada probe individual usa `limit(1)` e somente os vizinhos encontrados são transferidos; a quantidade de probes é constante e não cresce com o tamanho do arquivo.

## Rotas públicas e compatibilidade

O contrato multi-campaign canônico está em [architecture/multi-campaign](../architecture/multi-campaign.md).

- arquivo agregado: `/campanhas/sessoes`;
- archive específico: `/campanhas/[campaign]/sessoes`;
- detalhe canônico: `/campanhas/[campaign]/sessoes/[sourceSessionId]`;
- alias histórico de `public_slug` resolve primeiro a identidade pública da campanha e redireciona **308** para o detalhe canônico, preservando `sourceSessionId`;
- alias retirado e campaign private/archived falham fechados como rota pública inexistente; indisponibilidade da dependência permanece estado temporário e não vira 404;
- `/sessoes` torna-se compatibilidade para o agregado;
- `/sessoes/[sourceSessionId]` só pode resolver o boundary legado explicitamente conhecido e redirecionar; não faz lookup global.

O legado por fragmentos `#/sessao/{sourceSessionId}` e `#/sessao/{sourceSessionId}/resumo` continua compatível somente pela mesma regra: a ponte não pode escolher campaign por coincidência de source ID.

### Navegação em resumos públicos longos

O leitor público deriva âncoras estáveis dos headings já publicados, sem alterar o texto editorial. Títulos repetidos recebem sufixos determinísticos para impedir colisões; o heading da própria sessão, quando repetido como primeiro H1 do Markdown, continua oculto do corpo e não entra no índice.

A navegação “Nesta sessão” só aparece quando o resumo possui seções suficientes para justificar o controle. Em documentos extensos, o índice usa seleção compacta em vez de despejar dezenas ou centenas de links na primeira viewport; a seção observada atualiza o controle, deep links preservam o fragmento no histórico e o destino recebe foco após navegação. Headings usam `scroll-margin` para não ficar escondidos sob o chrome flutuante. Sessões curtas permanecem sem índice adicional.

## Invariantes

- session pertence a exatamente uma campaign;
- source/session lookup é campaign-qualified quando campaign participa da identidade;
- move entre campaigns é mutation explícita, auditável e nunca simples troca de FK client-side;
- participant pertence a uma session;
- participant não é identity global;
- publicar session não publica automaticamente fontes;
- o arquivo público não amplia a audience de métricas privadas por agregação;
- provenance nunca é removida por reconciliação;
- lifecycle narrativo/editorial e processing job não devem ser tratados como o mesmo estado.

## Futuro

- diretório e archives multi-campaign conforme ADR-0020;
- criação/edição de sessions pelo Edit;
- expected participants;
- live session mode;
- timeline agregada;
- markers de cena/objetivo;
- melhor reconciliação de guest/aliases.

Qualquer feature futura deve preservar a distinção entre occurrence (`participant`) e identity (`profile/entity`).

## Edit multi-campanha e move seguro — #1129

A biblioteca privada de sessões usa contexto explícito de campanha:

- `/edit/sessoes` é somente entrypoint/seleção; redireciona automaticamente apenas quando existe exatamente uma campanha autorizada;
- `/edit/[technical_slug]/sessoes` é a biblioteca canônica;
- `/edit/[technical_slug]/sessoes/[source_session_id]` é o detalhe canônico;
- `source_session_id` não é lookup global e pode existir em campanhas diferentes;
- leitura e mutations revalidam a campanha no servidor; o pathname/selector é intenção de UI, não autoridade.

“Mover para outra campanha” é uma ação separada do draft editorial. O fluxo é `preflight -> confirmação -> commit`. Destinos são somente campanhas ativas com transcript read + content edit para o actor. O banco revalida origem e destino novamente no preflight/commit.

O primeiro slice (#1129) foi deliberadamente fail-closed e continua sendo a base de compatibilidade. O boundary v2 (#1454) amplia o mesmo contrato para sessões editoriais populadas sem transformar a operação num update genérico de FK.

### Boundary v2 para sessão populada

O preflight v2 devolve um plano estruturado e versionado. Cada família ligada à session é classificada como:

- `auto`: acompanha a session ou tem ownership atual atualizado no commit;
- `historical`: permanece como evidência histórica, sem falsificar a campaign onde o evento ocorreu;
- `external_prepare`: exige side effect verificado antes do commit PostgreSQL, hoje a capa/R2;
- `decision`: exige escolha humana explícita;
- `hard_block`: não possui reconciliação segura dentro deste boundary.

Toda FK direta para `sessions(id)` precisa constar no registry de políticas. Uma relação nova ou uma relation/column obrigatória ausente deixa `registryComplete=false` e desativa o v2. O default é negar, não presumir que a dependência é inofensiva.

### Transcript e drafts

Revisions atuais da transcrição acompanham o ownership da session sem regenerar payload, hashes, revision numbers, operation IDs ou parent lineage. As tabelas campaign-owned preservam `origin_campaign_id` para distinguir onde a evidência foi originalmente criada do ownership operacional atual.

Drafts editoriais antigos continuam imutáveis na campaign de origem. Se existe current draft, o move cria um **bridge draft** imutável na destination, usando o próximo revision number da própria session, a mesma base transcript e os mesmos campos editoriais. O pointer `current_editorial_draft_id` avança para esse bridge. Assim a próxima edição/publicação usa um draft coerente com a destination sem reescrever histórico.

### Sessão já publicada

Move de uma publicação ativa nunca republica automaticamente no destino. A única política v2 inicial é `publishedPolicy=unpublish`, escolhida explicitamente e autorizada por `campaign.sessions.publish` na origem.

No mesmo commit:

- o snapshot/receipt histórico permanece preservado e recebe ownership atual coerente, mantendo `origin_campaign_id`;
- `current_session_publication_id` é limpo;
- `status=published` volta para `approved`;
- `coverImageUrl` e `heroImageUrl` públicos são removidos da projection materializada da session;
- a nova campaign só volta a publicar conteúdo após uma publicação editorial explícita normal.

Isso impede que mover para uma campaign privada mantenha exposição pública por acidente.

### Capa e R2

Uma capa moderna é campaign-owned no banco e também no namespace físico:

`campaigns/<technical_slug>/sessions/<session_id>/cover/<sha>.(png|webp)`.

Por isso o fluxo é `preflight -> prepare/read-back -> DB commit -> cleanup assíncrono/lifecycle`. O prepare copia bytes imutáveis para a chave destination e verifica hash/MIME/dimensões/read-back. Uma capa já pública só é promovida no namespace destination quando a **destination campaign também é pública**; destination privada recebe somente o objeto staged e metadata sem public delivery. O banco revalida essa regra no commit e rejeita receipt público para destination privada. O objeto da origem não é apagado no caminho crítico.

O commit recebe apenas um receipt de mídia verificado e materializa/reutiliza o `media_asset` destination antes de criar o bridge draft. Referência de capa legado exige decisão explícita `legacyCoverPolicy=clear_current`; o histórico antigo permanece intacto e o current bridge começa sem capa.

### Dependências que exigem decisão

O v2 nunca clona narrativa por nome.

- `participant.character_entity_id`: pode ser explicitamente removido; participant/texto histórico permanecem;
- `entity_mentions`: podem ser destacados da session, preservando a menção/entity original;
- `canon_candidates.related_entity_ids`: podem ser destacados somente enquanto não houver `canon_entries` materializados; canon já materializado continua hard blocker;
- grants `scope_type=session`: podem ser preservados ou revogados explicitamente, e qualquer decisão exige `campaign.permissions.manage` em origem e destino.

### Idempotência, recovery e caches

O commit usa `operation_id` durável, row lock, receipt e audit sanitizado. A identidade unresolved também é persistida de forma bounded no navegador, scoped por hash opaco do profile + session + origem + destino; reload/deploy pode reutilizar o mesmo operation id e reconciliar um commit cuja resposta se perdeu. Se o commit já moveu a session e o navegador recarrega o deep link antigo antes de receber a resposta, o servidor usa o receipt actor-scoped para reencontrar a session pelo ID estável e redireciona somente para uma campaign que o actor ainda pode ler. Nenhum transcript, resumo, grant ou URL privada entra nesse storage.

Dois movers concorrentes serializam no row lock; o writer stale recebe `conflict`. Alterar o conjunto de decisões com o mesmo `operation_id` retorna `operation_conflict`.

Depois do commit, a aplicação revalida Home, diretório/agregado público, aliases legados, archives/detalhes públicos de origem e destino e bibliotecas/detalhes privados. Falha de cache/delivery não desfaz o commit já confirmado; o retorno marca `cachePending` para recuperação explícita.


## Compatibilidade de leitura pública durante o rollout do registry

O rollout multi-campaign possui uma janela em que o app pode estar mais novo que o schema remoto. Para preservar as sessões já publicadas sem enfraquecer o boundary novo, o repository público usa dual-read estritamente classificado:

- primeiro tenta a projection first-class com campaign `active/public`;
- somente `42703` ou `PGRST204` que apontem para `public_slug`, `lifecycle` ou `visibility` de `campaigns` autorizam a projection legado;
- a projection legado consulta exclusivamente o technical slug histórico `yuhara-main` e o apresenta como `cronicas-da-mesa`;
- outro campaign route não pode ser satisfeito pelo fallback histórico;
- erros de permissão/transporte/schema não relacionados continuam indisponibilidade, nunca vazio;
- `status=published` permanece obrigatório nos dois caminhos. `ready_for_review` não é publicado por compatibilidade.

Quando o registry está disponível, o caminho legado não participa da decisão e as regras `lifecycle=active` + `visibility=public` continuam sendo a autoridade de exposição.
