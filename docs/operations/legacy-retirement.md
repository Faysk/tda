# Retirada do projeto Vercel legado

> Status: executado e verificado
> Owner: infraestrutura/operação
> Última revisão: 2026-09-07
> Fonte: Vercel CLI e health público

## Alvo e autorização

O proprietário solicitou excluir o projeto antigo. Foram conferidos equipe DND (`dndscribe`), nome `dnd-scribe`, ID `prj_f9dVc7yr981wW9TkX0KbjeMrbSUm` e associação ao alias `dnd.faysk.dev` antes da ação.

A exclusão foi confirmada no CLI. Consulta posterior `project inspect dnd-scribe --scope dndscribe` retorna `project_not_found`; deployment pelo domínio nessa equipe também não é encontrado. Não foram excluídos TDA, GitHub, Supabase ou buckets como parte dessa operação.

## Continuidade do domínio

O domínio responde HTTP 200 porque o novo TDA já foi associado em outra entrega, registrada no [histórico de deployments](deployments.md). Consulta atual a `/api/health` confirmou `application=tda`, `environment=production`, `ok=true` e commit nulo. Isso não significa que o projeto antigo ainda exista.

Health não identifica sozinho o SHA nesse deployment direto; consultar registro de publicação e Vercel. Nenhum novo deployment ou ajuste DNS foi executado nesta verificação.

## Consequências

GitHub `Faysk/dnd-scribe` permanece referência. Não recriar o projeto antigo nem usá-lo para rollback. Novas operações conferem equipe e ID do TDA. Exclusão de hosting não autoriza apagar dados no Supabase/R2.
