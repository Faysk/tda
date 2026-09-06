# Evidências, transcrição e classificação

> Status: implementado + modernização planejada
> Owner: evidence/transcription
> Última revisão: 2026-09-06

## Objetivo

Preservar rastreabilidade entre o que aconteceu/capturamos e qualquer interpretação derivada, sem transformar automaticamente áudio, fala, evento ou saída de IA em verdade oficial.

## Regra de ouro

```text
fonte != interpretação != canon
```

O legado já definia:

> Nada vira canon sem fonte. Nada é publicado sem revisão.

Essa regra foi revalidada no reboot.

## Tipos de fonte

### Áudio/arquivo

`recording_files`, `audio_chunks`, `audio_speech_slices`.

### Transcript

`transcript_segments` com offsets e lineage de arquivo/chunk.

### Roll20

`roll20_events` com payload/raw source e timing aproximado.

### Markers

`session_markers` de Craig/Discord/Roll20/site/manual/detecção.

### Notas

`table_notes` e `historical_documents`.

## Transcrição

Segmento deve preservar quando disponível:

- session;
- arquivo/chunk;
- track;
- participant/speaker;
- offsets absolutos;
- texto;
- confidence;
- provider/run/provenance indireta;
- status de revisão.

### Correção

Correção de transcript não deve apagar origem de forma que impeça auditoria. Quando o Edit permitir editar texto/speaker, registrar old/new e ator conforme política de audit.

## Classificação

`segment_classifications` guarda categoria/relevância/confiança/rationale e provenance do modelo.

Categorias históricas revalidadas como vocabulário útil incluem:

- `dm_narration`;
- `in_character`;
- `player_action`;
- `mechanics`;
- `roll_result`;
- `table_planning`;
- `lore_discussion`;
- `ooc_chatter`;
- `joke`;
- `break`;
- `technical`;
- `sensitive_private`;
- candidates de quote/canon/outtake.

O schema não precisa necessariamente transformar cada string histórica em enum rígido; o domínio deve versionar o classificador/prompts quando o contrato for estabilizado.

## Canon relevance

Valores físicos atuais: `none | low | medium | high`.

São sinal para revisão, não aprovação.

## Confidence

Confidence ajuda triagem e entity resolution, mas não substitui decisão humana.

Referência histórica útil:

- 0.90–1.00: muito provável;
- 0.70–0.89: provável/revisar;
- 0.40–0.69: ambíguo;
- abaixo de 0.40: fraco.

Essas faixas são heurística histórica, não SLA estatístico comprovado do reboot. Qualquer uso automatizado precisa validação com dados reais.

## O que pode gerar candidato de canon

Exemplos revalidados:

- ação executada;
- decisão tomada;
- revelação do mestre;
- consequência narrativa/mecânica relevante;
- morte;
- item recebido/perdido;
- mudança de local/facção;
- pacto/juramento;
- descoberta;
- mudança de reputação.

## O que não deve ser promovido automaticamente

- piada OOC;
- plano não executado;
- especulação de jogador;
- conversa pessoal;
- comentário técnico;
- meme;
- interpretação não confirmada;
- sugestão de futuro.

## Candidatos

### Canon candidate

Claim/fato proposto. Mantém fontes e estado.

### Quote candidate

Fala marcante; pode ser IC ou OOC. Aprovação pública é separada.

### Outtake candidate

Bastidor. Possui sensibilidade e aprovação própria. Não é canon.

## Source IDs em arrays

O schema histórico usa arrays de UUID para fontes relacionadas em alguns candidatos. Isso facilita ingestão, mas reduz integridade relacional comparado a join tables.

Antes de escalar edição/consulta pesada dessas relações, avaliar migration para tabelas de source links first-class sem apagar provenance existente.

## Entity mentions

Entity resolution pode produzir `entity_mentions`, mas isso significa somente:

> esta entity foi mencionada/identificada nesta evidência.

Não significa:

- relação entre entities;
- verdade do texto;
- conhecimento do personagem;
- canon.

## Reprocessamento

Reprocessar transcrição/classificação deve preservar lineage e permitir distinguir runs.

Regras desejadas:

- idempotência por source hash/config;
- cache quando input/config é equivalente;
- `source_run_id` para derivação;
- não duplicar candidates ao repetir job;
- não sobrescrever revisão humana com output novo.

## Privacidade

Evidência pode conter conversa pessoal, dados sensíveis e material nunca destinado a jogadores/público. Portanto transcript bruto não deve ser incluído em payload público por conveniência.

## Futuro

- player de áudio por timestamp no Edit;
- correção de speaker/texto auditável;
- avaliação comparativa de modelos locais/cloud;
- entity resolution assistida;
- busca semântica com source citations;
- índice temporal por entity;
- melhor contrato de source links.
