# ADR-0001 — TDA como identidade canônica; dnd-scribe como legado

> Status: accepted
> Data: 2026-09-06

## Contexto

`Faysk/dnd-scribe` acumulou produto, pipeline, documentação e experimentos. O proprietário iniciou `Faysk/tda` como reboot, preservando dados e ideias úteis sem importar automaticamente arquitetura e declarações antigas de conclusão.

O banco ainda contém scopes/consumidores com o nome `dnd-scribe`.

## Decisão

- `Faysk/tda` é a fonte de verdade do reboot.
- identidade técnica do produto novo: `tda`.
- `Faysk/dnd-scribe` é fonte histórica/legado.
- `project/dnd-scribe` permanece apenas como compatibilidade enquanto consumidores antigos dependerem dele.
- campanha `yuhara-main` e provenance (`craig`, `discord`, `roll20`, `local_companion`) não são renomeadas por branding.

## Consequências positivas

- documentação nova não herda estados falsos de conclusão;
- arquitetura pode ser simplificada;
- dados e conhecimento histórico continuam reaproveitáveis;
- transição pode ocorrer sem big-bang.

## Trade-offs

- dois scopes técnicos coexistem temporariamente;
- é necessário consultar legado para intenção histórica;
- remoção definitiva exige inventário de consumidores.

## Condição para remover compatibilidade

- nenhuma API/script/RPC depende de `dnd-scribe`;
- companion e integrações usam `tda`;
- testes comprovam independência;
- migration explícita remove assignments/compatibilidade obsoleta.

## Referências

- [Legado](../legacy/README.md)
- [Modelo de dados](../data-model.md)
- [Migrations](../database/migrations.md)
