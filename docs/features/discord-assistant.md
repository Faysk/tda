# Feature — Assistente Discord

> Status: histórico/planejado
> Owner: integrations/discord + narrative query
> Última revisão: 2026-09-06

## Valor

Consultar e registrar informação da campanha a partir do Discord com o mesmo modelo de autorização/canon do TDA, sem criar uma base paralela no bot.

## Ideias históricas

Comandos como:

- recap;
- onde estamos;
- NPC;
- item;
- gancho;
- fala;
- bastidor;
- canon;
- session.

Nomes/UX podem mudar quando a feature entrar no roadmap executável.

## Base existente

- `discord_interactions`;
- profile/discord IDs;
- `table_notes`;
- RBAC/capabilities;
- entities/canon/publications;
- future semantic search.

## Princípio

Discord é **interface**, não autoridade.

```text
Discord user
 -> resolve profile
 -> capability/scope
 -> TDA query/action
 -> filtered response
 -> interaction audit/log
```

## Queries

Consulta deve usar serviços de domínio do TDA e respeitar audience. Não ler tabelas privadas diretamente com service key no bot só porque é simples.

## Escrita

Comandos de nota/canon devem criar note/candidate/reviewable object, não `canon_entry` direta sem gate apropriado.

## Ephemeral/private responses

Quando resposta contiver conteúdo restrito, usar mecanismo de resposta adequado e ainda assim limitar payload/log. Ephemeral de Discord não substitui authorization do backend.

## Identity mapping

Discord user ID pode ajudar a resolver profile. Handle/nickname mutável não é identidade suficiente.

## Semantic Q&A futuro

Se bot usar busca/LLM:

- retrieval já filtrado pela permission;
- citations/source links;
- separar canon/interpretação;
- não recuperar secret para depois pedir ao modelo para esconder.

## Rate/cost

Registrar interactions e proteger comandos caros contra abuso. Semantic search/LLM deve considerar quota/rate/capability.

## Critérios de aceite

- usuário não vinculado recebe fluxo seguro, não acesso genérico;
- player não consulta master secret;
- comando de write não pula review;
- duplicate interaction ID é idempotente;
- logs não vazam secrets;
- resposta aponta para TDA/source quando útil.

## Não fazer agora

- bot com service-role omnipotente sem authorization;
- duplicar wiki/canon em storage do Discord;
- prompt-only security;
- comandos que transformam texto do chat diretamente em canon.
