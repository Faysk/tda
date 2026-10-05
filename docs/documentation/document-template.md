# Template de documento

Use este modelo para documentação técnica ou de domínio nova. Remova seções que realmente não se aplicam; não deixe cabeçalhos vazios só para cumprir ritual.

```md
# Título

> Status: implementado | preparado | planejado | em desenho | histórico
> Owner: domínio/time/componente
> Última revisão: YYYY-MM-DD
> Fonte de verdade: caminho/schema/serviço

## Objetivo

O que este documento define e o que ele não define.

## Current behavior

Contrato vigente/implementado na baseline indicada no cabeçalho. Se o documento não descreve runtime atual, remover esta seção.

## Legacy compatibility

Formatos/policies antigos ainda aceitos e a razão da compatibilidade. Remover se não houver legado relevante.

## Historical implementation notes

Snapshots datados de candidatos, PRs ou incidentes que ajudam a explicar a evolução, sem competir com o contrato vigente.

## Future backlog / unresolved decisions

Somente capacidades ainda futuras ou decisões abertas. Não manter aqui trabalho já implementado.

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

## Validação

Testes, queries ou critérios verificáveis.

## Riscos e dívida técnica

Riscos conhecidos e por que ainda não foram resolvidos.

## Referências

Links para docs canônicos, ADRs, migrations e fontes históricas revalidadas.
```
