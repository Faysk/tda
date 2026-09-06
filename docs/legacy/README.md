# Legado e fontes históricas — `Faysk/dnd-scribe`

> Status: histórico/referência
> Owner: documentação/arquitetura
> Última revisão: 2026-09-06

## Regra

`Faysk/dnd-scribe` é uma **biblioteca histórica de intenção, evidência e implementação antiga**. Não é fonte de verdade do reboot.

Ao consultar o legado, sempre perguntar:

1. isto descreve dado real ainda existente?
2. isto descreve uma intenção que o proprietário ainda quer?
3. isto é apenas estado/conclusão da implementação antiga?
4. isto conflita com uma decisão nova do TDA?
5. precisa ser revalidado e trazido para docs canônicos?

## Classificações

### Revalidado

A intenção foi confirmada e já está no contrato TDA.

### Adaptado

O objetivo permanece, mas arquitetura/implementação mudou.

### Compatibilidade temporária

Mantido apenas para não quebrar operação antiga.

### Histórico

Útil para entender passado, sem compromisso de implementação.

### Não localizado/não comprovado

Há referência à feature/dado, mas fonte real não foi encontrada ou validada.

## Mapa das principais fontes

### `docs/01_objetivos_e_escopo.md`

**Classificação: revalidado/adaptado.**

Contribuições preservadas:

- sessões longas transformadas em registros organizados, auditáveis e publicáveis;
- fonte/timestamp/speaker/canon como perguntas centrais;
- revisão antes de publicar;
- evolução futura para wiki viva, grafo, timeline, busca semântica e modo Mestre/Jogador.

O MVP antigo não é o roadmap atual. A intenção de produto permanece e está redistribuída no [roadmap TDA](../roadmap.md).

### `docs/02_contexto_da_campanha.md`

**Classificação: revalidado como contexto de domínio.**

Contribuições importantes:

- campanha longa com memória acumulada;
- distinguir fato, interpretação, especulação, rumor, mentira, piada e gancho;
- necessidade de fonte, revisão e visibilidade;
- entities centrais e temas como memória, identidade, arte, política e consequência.

Esse documento reforça por que o TDA não pode ser apenas uma wiki de texto solto.

Fonte canônica nova: [data model](../data-model.md), [canon/review](../domains/canon-review.md), [knowledge/audience](../features/knowledge-audience.md).

### `docs/02_mapa_de_telas.md`

**Classificação: revalidado/adaptado.**

O legado já separava superfícies para:

- sessão atual/captura;
- revisão;
- transcrição;
- canon;
- segredos;
- "quem sabe o quê";
- entities;
- bastidores;
- permissões.

A taxonomia de telas é histórica, mas a separação conceitual continua valiosa. O reboot não precisa recriar exatamente a mesma navegação.

### `docs/03_regras_de_visibilidade.md`

**Classificação: revalidado.**

Regra central preservada:

> **Quem vê no sistema** e **quem sabe dentro da ficção** são dimensões diferentes.

Também diferencia diário pessoal, segredo de personagem, segredo compartilhado, segredo do DM, canon público e bastidor.

Fonte canônica nova: [Identity/access](../domains/identity-access.md) + [Knowledge/audience](../features/knowledge-audience.md).

### `docs/03_segredos_e_conhecimento.md`

**Classificação: revalidado.**

Confirma a mesma separação com exemplos de pessoa/personagem e descreve que diário pessoal não vira canon automaticamente, enquanto segredo validado pode gerar consequência narrativa.

Essa fonte passa a ser referência histórica principal para o futuro modelo de knowledge.

### `docs/08_classificacao_auditoria_canon.md`

**Classificação: revalidado/adaptado.**

Contribuições preservadas:

- fonte obrigatória;
- separação canon/interpretação/hook/retcon/private;
- candidatos de quote/outtake;
- revisão humana;
- ideia de timeline + transcript + candidates + source/audio.

Fonte canônica nova: [Canon/review](../domains/canon-review.md) e [Evidence](../domains/evidence.md).

### `docs/09_modelo_de_dados_supabase.md`

**Classificação: revalidado/adaptado.**

Foi a base histórica de campaigns/profiles/sessions/transcript/candidates/entities/publications/audit. O schema real evoluiu muito além dele.

Fonte canônica nova: [schema catalog](../database/schema-catalog.md) e [data model](../data-model.md).

### `docs/16_ideias_futuras.md`

**Classificação: histórico com várias intenções revalidadas.**

Contém:

- wiki viva;
- NPCs/lugares/itens/músicas;
- relações;
- mapas;
- "quem sabe o quê";
- busca semântica;
- clocks narrativos;
- bot Discord;
- export de memória para LLM;
- modo mestre/live;
- rumores.

Esses itens **não formam backlog automático**. Estado de cada um está no [feature catalog](../feature-catalog.md).

### `docs/35_roadmap_proximas_10_etapas.md`

**Classificação: histórico.**

É valioso para paridade do antigo Review Board, áudio por timestamp, criação de session, ingest, worker, Roll20, Discord/Craig, histórico Markdown e entities/canon.

Os próprios arquivos do legado marcam esse roadmap como substituído. Fonte vigente: [roadmap TDA](../roadmap.md).

### `docs/49_resultado_etapa_21_entidades_canon_consolidado.md`

**Classificação: histórico técnico relevante.**

Comprova a intenção antiga de consolidar somente `approved_canon` em `canon_entries` e criar/atualizar `entities`.

Também revelou dependência do consolidator em `(campaign_id, name)`, preservada temporariamente no schema atual.

Fonte vigente: [Entities](../domains/entities.md), [Canon](../domains/canon-review.md), [database audit](../database-audit.md).

## Design System oficial vindo do legado

Em 2026-09-06 o proprietário forneceu **TDA Design System v1.0.0** como arquivo oficial do reboot.

O pacote foi extraído do snapshot:

`Faysk/dnd-scribe@68e974c0eb240e1658772f8ae64da36530f9452e`

Classificação:

**revalidado e promovido como contrato visual**, com adaptação de paths/implementação para `Faysk/tda`.

Importante:

- os tokens/princípios visuais foram promovidos;
- `apps/web/...` citado no snapshot não é arquitetura vigente;
- Brand Pack continua fonte separada para masters da marca;
- a implementação atual do reboot ainda precisa migrar completamente para os tokens oficiais.

Fonte canônica nova: [Design System TDA](../design-system/README.md).

## Documentação `docs/reboot/`

O próprio `dnd-scribe` criou, no fim da vida como repo principal, uma documentação de reboot modular em 2026-09-06. Ela é especialmente útil para recuperar intenção que precedeu a criação/separação do `Faysk/tda`.

O índice histórico cobre:

- produto/escopo;
- arquitetura/transcrição;
- stack/versionamento;
- Git/ambientes/publicação;
- preservação/migração de dados;
- identidade/site público;
- Edit/paridade;
- qualidade/segurança/operação;
- lore/expansão;
- roadmap/aceite;
- riscos/decisões;
- governança documental.

**Classificação: histórico de transição.** A documentação nova deste repositório substitui seu papel normativo.

### `docs/reboot/09-lore-temporaria-e-expansao.md`

Registra que personagens/NPCs/pets/itens/lugares, relações, acontecimentos, facções, timeline, músicas, galerias e busca eram candidatos futuros, e que React Flow era opção visual a avaliar depois de definir o modelo.

Essa cautela foi preservada: visualização não dita schema.

A avaliação foi concluída em 2026-09-06 e React Flow agora é escolha aceita para a camada visual do World Explorer por [ADR-0006](../adr/0006-react-flow-world-explorer.md).

## React Flow: evolução da decisão

Histórico:

```text
legado: candidato
 -> reboot inicial: candidato revalidado
 -> análise de design/modelo/acessibilidade/performance
 -> ADR-0006: aceito para visualização
```

O que foi aceito:

- `@xyflow/react` para canvas/nodes/edges/interação;
- custom nodes/edges;
- projection layer;
- acessibilidade textual alternativa;
- layout radial inicial.

O que **não** foi importado/decidido pelo React Flow:

- schema de relation;
- relation types;
- knowledge;
- canon;
- visibility;
- posicionamento persistente de domínio.

## Implementação antiga a consultar quando necessário

### `apps/web`

Frontend público anterior/estrutura web de transição. Consultar para paridade e comportamento, não copiar arquitetura cegamente.

### `web/central-local`

Edit/operador temporário do legado. Fonte importante para descobrir fluxos de revisão que precisam de paridade funcional.

### `local-companion`

Pipeline local a preservar/modernizar. Deve ser baseline de comportamento e performance.

### `api` / `lib`

Pode conter RPC consumers, scope `dnd-scribe`, integrações e regras ainda operacionais.

### `schemas` / `supabase`

Histórico de criação do schema e migrations antigas. O Supabase remoto é autoridade física atual.

### `integrations`

Roll20/Discord e demais conectores históricos.

## Regras de migração de conhecimento

Quando algo útil for encontrado no legado:

```text
legado
 -> verificar código/schema/dado real
 -> confirmar intenção vigente
 -> registrar em doc TDA canônico
 -> ADR se estrutural
 -> implementar
 -> validar
```

Nunca:

```text
"está num .md antigo" -> implementar como requisito vigente
```

## Itens históricos já explicitamente tratados

| Tema | Tratamento no TDA |
| --- | --- |
| nome dnd-scribe | legado; `tda` canônico |
| campaign `yuhara-main` | preservada |
| Craig/local processing | preservado e modernizado |
| entities | revalidado e alinhado |
| PC vs NPC | registry única |
| canon gate | revalidado |
| Design System v1.0 | revalidado/promovido como direção visual oficial |
| React Flow | aceito por ADR-0006 para visualização do World Explorer |
| relations | intenção revalidada; contrato proposto; schema não migrado |
| knowledge/audience | intenção revalidada; schema em desenho |
| semantic search | planejado, source-aware |
| lore/pipipi | fonte não comprovada no registro histórico; não considerar publicada/existente sem localização |
| scope `dnd-scribe` | compatibilidade temporária |

## Critério para arquivar de vez o legado operacional

- site TDA publicado e independente;
- Edit possui paridade necessária;
- companion modernizado/sincronizado;
- nenhuma credencial/scope/API depende do repo antigo;
- conteúdo necessário foi migrado/registrado;
- rollback não exige ressuscitar arquitetura antiga;
- documentação nova cobre decisões e runbooks necessários.