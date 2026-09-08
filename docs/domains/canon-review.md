# Canon, revisão e publicação

> Status: schema implementado; operação integrada ainda preparada/planejada
> Owner: review/canon
> Última revisão: 2026-09-08

## Objetivo

Permitir que IA e fontes ajudem a organizar a campanha sem confundir sugestão com verdade. O domínio transforma evidência em material revisável e, somente após decisão autorizada, em memória/publicação.

## Regra de ouro

```text
Nada vira canon sem fonte.
Nada é publicado sem revisão apropriada.
Nada sensível vira bastidor público sem aprovação.
```

## Níveis de autoridade

```text
raw source
  ↓
derived transcript/event
  ↓
classification
  ↓
candidate
  ↓
human review
  ↓
approved canon / publication
```

Cada nível preserva o anterior como provenance.

## Curadoria de dados reais — rodada #99

A [issue #99](https://github.com/Faysk/tda/issues/99) usa dados reais da campanha para alimentar lore e World Explorer, mas **não cria um caminho alternativo ao review gate**.

A curadoria por Cuscuz deve produzir material revisável com, no mínimo, estas quatro dimensões já pertencentes aos contratos existentes:

1. **provenance:** fonte identificável e suficiente para voltar à evidência original sem copiar transcript privado para docs/issues;
2. **natureza da claim:** distinguir explicitamente fato suportado pela fonte, inferência/interpretação e conflito/ambiguidade;
3. **review:** candidato continua candidato até decisão humana autorizada; ausência de revisão nunca é convertida em aprovação por conveniência do grafo/lore;
4. **visibility:** definir audience antes de qualquer projection pública; `private`, `review_only`, `private_master` ou equivalente não pode escapar para browser/metadata público.

A rodada não aprova enum, coluna ou tabela nova por documentação. Se o schema atual não conseguir representar alguma distinção sem ambiguidade, registrar a lacuna no owner de dados antes de inventar metadata ad hoc.

### Fluxo recomendado para entities e relações

```text
resumo/transcript/evidência real
  -> extração/classificação com provenance
  -> candidate revisável
  -> decisão humana
  -> canon entry quando apropriado
  -> entity/relation projection autorizada
  -> lore/grafo conforme visibility
```

Para relações, o contrato adicional está em [relations-data-contract](../features/relations-data-contract.md): coocorrência, inferência de modelo ou proximidade visual não viram edge canônico. Relação pública precisa de fonte/revisão e pode ter visibility mais restrita que seus endpoints.

### Privacidade da própria curadoria

- não colocar transcrição bruta, conversa pessoal, source payload integral ou IDs sensíveis em issue, fixture pública ou documentação;
- exemplos sintéticos devem continuar claramente sintéticos;
- dataset de teste visual não prova que a relação existe na campanha;
- screenshots de revisão podem comprovar composição/UX, mas não substituem receipt, query, teste de audience ou decisão humana registrada.

## Canon candidate

Um candidate é uma **claim proposta**.

Estados físicos atuais:

- `candidate`;
- `approved_canon`;
- `rejected`;
- `interpretation`;
- `possible_hook`;
- `retcon_pending`;
- `private`;
- `published`.

### Semântica

`interpretation` não deve ser apresentada como fato.

`possible_hook` descreve possibilidade futura, não evento acontecido.

`retcon_pending` sinaliza conflito/correção pendente.

`private` controla audience operacional e não significa automaticamente canon.

## Quote candidate

Fala interessante com contexto/fonte. Pode ser IC/OOC. `approved_for_public` trata publicação, não canon.

## Outtake candidate

Bastidor é domínio separado de canon.

Níveis atuais de sensibilidade:

- normal;
- needs speaker approval;
- private;
- sensitive.

Fluxo deve respeitar aprovação exigida pelo conteúdo, inclusive quando session/publication geral já é pública.

## Review decision

Decisão humana deve registrar target, ação, notas, ator e provenance quando disponível.

A UI futura deve tornar rápido revisar sem esconder impacto. Atalhos históricos podem ser revalidados, mas backend continua validando ação/capability.

## O que pode virar canon

Exemplos:

- ação efetivamente executada;
- decisão tomada;
- revelação factual do mestre;
- morte;
- item recebido/perdido;
- mudança de lugar/facção;
- pacto/juramento;
- consequência relevante;
- descoberta;
- evento público;
- reputação alterada.

## O que não vira canon automaticamente

- plano não executado;
- hipótese/especulação;
- joke/OOC;
- meme;
- regra discutida sem consequência narrativa;
- interpretação simbólica não confirmada;
- sugestão de futuro.

## Canon entry

`canon_entries` é memória consolidada.

Regras:

- deriva de candidate aprovado;
- mantém `source_candidate_id`;
- pode apontar para entity;
- tem visibility;
- suporta lifecycle `active | superseded | retcon_pending | archived`;
- não deve ser criada por migration de backfill apenas para preencher tabela.

## Supersession e retcon

Não apagar fact antigo para fingir que nunca existiu.

Direção:

```text
entry A active
  -> revisão/retcon
entry A superseded
entry B active (nova formulação)
```

A ligação explícita entre versões ainda pode ganhar modelo adicional no futuro; por enquanto preservar source/history/status.

## Publication

Publication é artefato editorial:

- recap curto/completo;
- mudanças de canon;
- timeline;
- quotes;
- outtakes públicos;
- master notes;
- player version;
- outros.

Status: `draft | approved | published | archived`.

Visibility: `private_master | private_players | review_only | public_campaign | public_web`.

## Diferença canon × publication

Canon responde:

> o que é aceito como fato/memória estruturada?

Publication responde:

> qual representação editorial desse conteúdo será entregue a qual audiência?

Uma publication pode omitir canon sensível. Um canon entry não precisa existir como publicação independente.

## Publicação do site

O frontend público consulta somente conteúdo explicitamente publicado/permitido. Não gerar página pública diretamente de candidate ou transcript.

Na rodada #99, isso vale tanto para Pipipi quanto para dados do grafo: uma página/edge visualmente pronta não é publicação sem visibility apropriada, projection pública e evidência do ambiente publicado.

## Auditabilidade

Idealmente toda ação crítica deve responder:

- quem decidiu?
- quando?
- sobre qual target?
- qual era o estado anterior?
- qual fonte sustentava a decisão?
- o que foi publicado/alterado?

`audit_log` existe, mas ainda não possui cobertura demonstrada completa; isso precisa ser implementado junto ao Edit.

## UI de revisão futura

Conceito histórico revalidado:

```text
Timeline | Transcript | Candidates | Source/Audio
```

Ações úteis:

- canon;
- reject;
- interpretation;
- hook;
- retcon pending;
- quote;
- backstage;
- private;
- corrigir speaker/texto.

A experiência pode mudar, mas deve preservar fonte e consequência clara da ação.

## Permissions

Capabilities devem distinguir pelo menos conceitualmente:

- visualizar evidence;
- revisar candidates;
- aprovar canon;
- publicar conteúdo;
- visualizar conteúdo master/private;
- administrar revisão/identidade.

Não assumir que todo player que lê recap pode abrir transcript ou candidate privado.

## Futuro

- Review Board integrado ao Next;
- source/audio por timestamp;
- bulk review seguro;
- entity resolution dentro da revisão;
- retcon history visual;
- memory/wiki alimentada por canon aprovado;
- comparação entre versões/publications;
- audit log efetivo de writes críticos.
