# Campanhas, sessões e participantes

> Status: implementado
> Owner: sessions
> Última revisão: 2026-10-01

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

### Arquivos públicos multi-campanha\n\nA rota canônica agregada é `/campanhas/sessoes`; `/campanhas/[campaign]/sessoes` restringe a uma campanha e `/campanhas/[campaign]/sessoes/[sourceSessionId]` identifica o detalhe por campanha + source ID. `/sessoes` é alias de compatibilidade do agregado e `/sessoes/[sourceSessionId]` só redireciona quando a resolução legada é inequívoca.\n\nNo agregado, arcos homônimos contam separadamente por campanha. O repository pagina server-side em lotes explícitos e não impõe teto silencioso de 500 registros. Enquanto o candidate #1123 não estiver aplicado, o fallback de compatibilidade só permite a campanha histórica; nenhuma campanha nova é inferida como pública.\n\n### Arquivo público legado `/sessoes`

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

## Rotas públicas e compatibilidade

O contrato multi-campaign canônico está em [architecture/multi-campaign](../architecture/multi-campaign.md).

- arquivo agregado: `/campanhas/sessoes`;
- archive específico: `/campanhas/[campaign]/sessoes`;
- detalhe canônico: `/campanhas/[campaign]/sessoes/[sourceSessionId]`;
- `/sessoes` torna-se compatibilidade para o agregado;
- `/sessoes/[sourceSessionId]` só pode resolver o boundary legado explicitamente conhecido e redirecionar; não faz lookup global.

O legado por fragmentos `#/sessao/{sourceSessionId}` e `#/sessao/{sourceSessionId}/resumo` continua compatível somente pela mesma regra: a ponte não pode escolher campaign por coincidência de source ID.

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

O primeiro slice é deliberadamente fail-closed: uma sessão sem dependências incompatíveis pode mudar de campaign; publication ativa, transcript revisions, editorial drafts, participant→entity links, cover/media referenciada, provenance, grants de sessão e demais domínios sem migração transacional segura bloqueiam a operação com razão acionável. Não existem clones silenciosos nem updates parciais.

O commit usa `operation_id` durável, row lock e audit sanitizado. Retry após resposta perdida reaproveita o receipt sem duplicar a mudança. Dois movers concorrentes serializam no row lock; o writer stale recebe conflict.

Depois do commit, a aplicação revalida bibliotecas/detalhes privados e superfícies públicas da origem/destino. Falha de cache/delivery não desfaz o commit já confirmado; o retorno marca `cachePending` para recuperação explícita.


## Compatibilidade de leitura pública durante o rollout do registry

O rollout multi-campaign possui uma janela em que o app pode estar mais novo que o schema remoto. Para preservar as sessões já publicadas sem enfraquecer o boundary novo, o repository público usa dual-read estritamente classificado:

- primeiro tenta a projection first-class com campaign `active/public`;
- somente `42703` ou `PGRST204` que apontem para `public_slug`, `lifecycle` ou `visibility` de `campaigns` autorizam a projection legado;
- a projection legado consulta exclusivamente o technical slug histórico `yuhara-main` e o apresenta como `cronicas-da-mesa`;
- outro campaign route não pode ser satisfeito pelo fallback histórico;
- erros de permissão/transporte/schema não relacionados continuam indisponibilidade, nunca vazio;
- `status=published` permanece obrigatório nos dois caminhos. `ready_for_review` não é publicado por compatibilidade.

Quando o registry está disponível, o caminho legado não participa da decisão e as regras `lifecycle=active` + `visibility=public` continuam sendo a autoridade de exposição.
