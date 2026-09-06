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

Registra que personagens/NPCs/pets/itens/lugares, relações, acontecimentos, facções, timeline, músicas, galerias e busca eram candidatos futuros, e que React Flow era apenas opção visual a avaliar depois de definir o modelo.

Essa cautela foi preservada: visualização não dita schema.

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
| React Flow | opção futura, não decisão |
| relations | intenção revalidada; schema em desenho |
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
