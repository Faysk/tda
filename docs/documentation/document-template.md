# Template de documento

Use este modelo para documentação técnica ou de domínio nova. Remova seções que realmente não se aplicam; não deixe cabeçalhos vazios só para cumprir ritual.

```md
# Título

> Status: implementado | preparado | planejado | em desenho | histórico
> Owner: domínio/time/componente
> Última revisão: YYYY-MM-DD
> Fonte de verdade: caminho/schema/serviço

## Current behavior

Resuma primeiro o contrato implementado/vigente. Um mantenedor deve conseguir descobrir o comportamento atual sem ler o diário histórico.

## Objetivo

O que este documento define e o que ele não define.

## Contexto

Por que isso existe; problemas que resolve; dependências relevantes.

## Escopo

### Inclui
- ...

### Não inclui
- ...

## Conceitos e vocabulário

Definições sem ambiguidade.

## Contrato / regras

Invariantes, estados, permissões, entradas/saídas, efeitos colaterais.

## Fluxo

```text
origem -> processamento -> persistência -> consumidor
```

## Modelo de dados

Tabelas/entidades/FKs relevantes. Linkar o catálogo físico em vez de copiar todas as colunas.

## Segurança e privacidade

Quem pode ler/escrever, audience, RLS, secrets, exposição ao browser.

## Falhas e recuperação

Principais failure modes, idempotência, retry, rollback e como detectar inconsistências.

## Observabilidade

Logs, métricas, auditoria e sinais de saúde.

## Legacy compatibility

Dependências temporárias, formatos/paths ainda aceitos e condição para remoção. Declare a authority corrente e não apresente legacy como comportamento preferencial.

## Historical implementation notes

Snapshots datados, issues/PRs, candidatos e evidências que valem como provenance, não como contrato atual.

## Validação

Testes, queries ou critérios verificáveis.

## Riscos e dívida técnica

Riscos conhecidos e por que ainda não foram resolvidos.

## Future backlog / unresolved decisions

Próximos passos ainda não entregues e decisões explicitamente abertas; não repetir capability já implementada como futura.

## Referências

Links para docs canônicos, ADRs, migrations e fontes históricas revalidadas.
```
