# Campanhas, sessões e participantes

> Status: implementado
> Owner: sessions
> Última revisão: 2026-09-08

## Objetivo

Modelar a campanha e cada sessão sem confundir:

- identidade persistente de pessoa/personagem;
- ocorrência numa sessão;
- arquivos capturados;
- lifecycle editorial/processamento.

## Campaign

Campaign é boundary de dados narrativos. Hoje a campanha principal é `yuhara-main`.

O fato de existir uma campanha não autoriza hardcode indiscriminado no domínio. Onde a query/ação pertence a uma campaign, o boundary deve ser explícito.

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

### Arquivo público `/sessoes`

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

## Compatibilidade de URL

O legado usava fragmentos `#/sessao/{sourceSessionId}` e `#/sessao/{sourceSessionId}/resumo`. O reboot converte apenas formatos conhecidos para `/sessoes/{sourceSessionId}` sem reintroduzir frontend legado.

## Invariantes

- session pertence a campaign;
- participant pertence a uma session;
- participant não é identity global;
- publicar session não publica automaticamente fontes;
- o arquivo público não amplia a audience de métricas privadas por agregação;
- provenance nunca é removida por reconciliação;
- lifecycle narrativo/editorial e processing job não devem ser tratados como o mesmo estado.

## Futuro

- criação/edição de sessions pelo Edit;
- expected participants;
- live session mode;
- timeline agregada;
- markers de cena/objetivo;
- melhor reconciliação de guest/aliases.

Qualquer feature futura deve preservar a distinção entre occurrence (`participant`) e identity (`profile/entity`).
