# Canon, revisão e publicação

> Status: schema implementado; operação integrada ainda preparada/planejada
> Owner: review/canon
> Última revisão: 2026-09-06

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
