# ADR-0009 — World Explorer multi-hub e layout espacial reorganizável

> Status: accepted
> Data: 2026-09-08
> Owner: frontend / narrative-memory
> Relacionado: ADR-0006

## Contexto

O primeiro slice do World Explorer, registrado no ADR-0006, validou React Flow, custom nodes/edges, inspector, filtros, acessibilidade e a projection layer. Naquele momento a composição prevista era radial, com uma entity focada no centro e dragging persistente desabilitado.

A validação visual e o feedback de produto mostraram que essa composição comunica uma hierarquia narrativa errada: um personagem parecia ser o centro permanente da campanha e todos os demais viravam satélites. Isso não representa a experiência desejada do TDA.

O World Explorer deve funcionar como um mapa de campanha: vários protagonistas podem ter peso equivalente; lugares, NPCs, facções, músicas e momentos formam constelações ao redor deles; selecionar uma entity deve inspecionar, e não redefinir a ontologia do grafo.

## Decisão

O TDA mantém **React Flow como engine de apresentação** e altera a estratégia espacial do World Explorer para uma experiência **multi-hub reorganizável**.

Esta ADR substitui especificamente as decisões de primeiro slice do ADR-0006 sobre:

- entity focal permanente no centro;
- layout radial de um único hub;
- posições sempre recalculadas exclusivamente a partir de um foco;
- dragging público desabilitado.

As demais decisões do ADR-0006, especialmente projection autorizada, separação de domínio, acessibilidade, performance e React Flow como camada de apresentação, continuam vigentes.

## Visão geral é o estado padrão

`/mundo` abre em modo `overview`.

Nesse modo:

- nenhum personagem é centro permanente;
- PCs visíveis são hubs narrativos pares;
- o layout inicial é determinístico e distribuído como constelação;
- entidades de contexto se organizam segundo conexões e hints curatoriais disponíveis;
- a câmera enquadra o conjunto útil, não um único protagonista.

A projection continua limitada ao que a audiência pode receber. "Visão geral" não significa enviar ao browser todo o grafo privado da campanha.

## Foco é uma exploração temporária

`/mundo?foco=<slug>` continua válido, mas passa a significar **recorte exploratório temporário**.

O foco:

- pode reduzir a projection para a vizinhança curta da entity;
- melhora leitura de relações densas;
- pode alterar enquadramento e destaque;
- não declara que a entity é o centro ontológico da campanha;
- pode ser encerrado voltando a `/mundo`.

Selecionar um node no canvas não altera a URL. Seleção serve para inspector e destaque contextual. A mudança de foco exige ação explícita de exploração.

## Layout e dragging

O layout inicial é produzido por uma função determinística da projection, com suporte a hints curatoriais quando existirem.

No modo público:

- nodes podem ser arrastados para reorganização visual local;
- dragging altera apenas estado de UI da sessão atual;
- dragging não altera canon, relation, entity, evidence ou visibility;
- dragging não grava implicitamente no Supabase;
- a ação `Reorganizar` restaura o layout determinístico da projection atual.

Persistência editorial de posições é uma capacidade futura separada. Quando existir, deverá possuir contrato próprio, autorização explícita e armazenamento desacoplado do canon narrativo.

## Peso visual

O tamanho/prominence de nodes é apresentação, não importância canônica.

Política inicial:

- PCs visíveis recebem prominence de herói equivalente;
- entidades diretamente conectadas podem receber prominence intermediária;
- contexto distante pode ser reduzido;
- seleção/foco adicionam destaque temporário sem reclassificar a entity no domínio.

## Relações e filtros

Filtros devem preservar contexto suficiente para a visualização continuar compreensível.

Ao filtrar lugares, facções, músicas ou outras categorias, os hubs relevantes podem permanecer visíveis mesmo que não pertençam à categoria escolhida, desde que isso seja necessário para mostrar a relação.

Filtros de família de relação reduzem edges e contexto associado sem mudar os dados de origem.

## Acessibilidade

A mudança para multi-hub não remove os requisitos do ADR-0006.

Continuam obrigatórios:

- alternativa textual das relações;
- navegação e foco visível;
- inspector utilizável sem depender de cor;
- semântica de relação por label e estilo, não apenas cor;
- controles adequados para touch;
- viewport sem overflow horizontal no mínimo suportado;
- `prefers-reduced-motion` respeitado.

## Consequências

### Positivas

- representa melhor uma campanha com múltiplos protagonistas;
- evita hierarquia narrativa acidental;
- torna o canvas mais próximo de uma ferramenta de exploração espacial;
- permite reorganização local sem contaminar domínio ou canon;
- mantém compatibilidade com foco por URL para compartilhamento e leitura de vizinhanças.

### Custos

- layout inicial fica mais sofisticado do que um radial simples;
- edges densos exigirão roteamento melhor em recortes posteriores;
- persistência editorial de layout exigirá um contrato próprio;
- testes precisam cobrir seleção, foco, dragging, filtros e responsividade separadamente.

## Fora deste recorte

Esta decisão não autoriza:

- escrever relações demo no Supabase;
- promover fixtures a canon;
- persistir posições públicas automaticamente;
- criar/editar relations pelo canvas público;
- enviar nodes/edges privados ao cliente para escondê-los depois.

## Próximos recortes

1. estabilizar a fundação multi-hub e seus gates de CI/E2E;
2. melhorar ports e roteamento visual de edges;
3. definir persistência editorial de layout separada do domínio narrativo;
4. expandir inspector e navegação contextual;
5. só então substituir fixtures por projections reais autorizadas.