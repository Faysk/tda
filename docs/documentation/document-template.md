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

## Compatibilidade / legado

Dependências temporárias, divergências conhecidas e condição para remoção.

## Validação

Testes, queries ou critérios verificáveis.

## Riscos e dívida técnica

Riscos conhecidos e por que ainda não foram resolvidos.

## Futuro

Próximos passos aprovados; separar claramente de ideias não aprovadas.

## Referências

Links para docs canônicos, ADRs, migrations e fontes históricas revalidadas.
```
