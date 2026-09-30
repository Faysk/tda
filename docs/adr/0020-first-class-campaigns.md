# ADR-0020 — campanhas first-class, identidade estável e rotas campaign-aware

> Status: accepted
> Data: 2026-09-30
> Owners: architecture / sessions / identity-access / navigation
> Decisão relacionada: #1122 / #1137

## Contexto

O TDA nasceu com uma campanha operacional principal identificada tecnicamente por `yuhara-main`. Esse estado foi suficiente para o primeiro produto, mas vários contratos passaram a carregar a suposição implícita de campanha única em rotas, autorização, processamento, mídia e projeções públicas.

A epic #1122 amplia o produto para múltiplas campanhas isoladas. A mudança não pode ser tratada como um dropdown visual: campaign passa a ser um boundary explícito de identidade, dados, autorização e navegação.

O schema já possui `campaigns` e muitos recursos já carregam `campaign_id` direta ou indiretamente. O problema principal é alinhar identidade, routing, discovery, compatibilidade e rollout sem renomear chaves técnicas existentes nem criar lookups globais ambíguos.

## Decisão

### 1. UUID é a autoridade relacional

`campaigns.id` é a identidade relacional estável. FKs e ownership persistido usam UUID.

Nenhuma URL, label ou slug público substitui o UUID como autoridade de relacionamento.

### 2. `campaigns.slug` é identidade técnica/compatível

O slug técnico existente, incluindo `yuhara-main`, permanece estável enquanto houver consumidores que dependam dele em RBAC, integrações, caches, mídia, processamento ou compatibilidade.

Ele não é renomeado para refletir nome editorial.

Novas campaigns recebem slug técnico único no momento de criação. O slug não deve ser alterado como efeito colateral de edição de nome público.

### 3. Nome público e rota pública são conceitos separados

A apresentação humana usa `name`.

A rota pública usa um identificador de apresentação separado do slug técnico, denominado neste contrato como **public route key**. A implementação física de #1123 pode materializá-lo como `public_slug` e, quando houver rename de rota, preservar aliases históricos versionados.

Regras:

- rename de `name` não altera automaticamente a URL;
- rename da public route key é uma operação explícita;
- alias histórico resolve para a campaign correta e redireciona para a URL canônica;
- alias nunca vira chave de FK, scope RBAC ou namespace de storage;
- `yuhara-main` continua válido como identidade técnica mesmo que a campanha seja apresentada como **Crônicas da Mesa**.

### 4. Lifecycle mínimo é `active | archived`

Lifecycle operacional de campaign é independente de visibilidade pública.

- `active`: campaign utilizável por fluxos operacionais autorizados;
- `archived`: preserva dados, grants históricos e URLs, mas bloqueia novas operações mutáveis salvo ação administrativa explícita.

Público/privado é decisão de discovery/audience, não terceiro estado de lifecycle.

### 5. Campaign context é explícito em toda operação campaign-owned

Uma ação sobre session, transcript, entity, World draft/layout, publication ou media binding resolve uma campaign no servidor e prova ownership antes de ler/mutar.

IDs de origem como `source_session_id`, entity slug e nomes editoriais não são globalmente únicos por definição.

Lookups devem ser campaign-qualified sempre que campaign participa da identidade.

### 6. Rotas canônicas carregam contexto quando a experiência é campaign-scoped

As rotas públicas agregadas continuam possíveis, mas uma experiência de uma campaign específica usa a public route key da campaign.

As ferramentas privadas passam a ter forma canônica `/edit/[campaign]/...`. Rotas privadas antigas sem campaign tornam-se compatibilidade/entrypoints e não podem escolher silenciosamente `yuhara-main` após a ativação da segunda campaign.

A matriz completa está em [Multi-campaign — contrato, rotas e rollout](../architecture/multi-campaign.md).

### 7. Project grants continuam semanticamente globais por capability

Um assignment ativo em `scope_type=project, scope_id=tda` continua podendo satisfazer a mesma capability em qualquer campaign, inclusive criada futuramente, porque esse é o significado do scope de projeto.

Isso não cria “superuser implícito”:

- a role precisa conter exatamente a action solicitada;
- discovery usa seu próprio contrato/capability;
- ownership do recurso ainda é resolvido;
- session/resource grants não herdam genericamente sem resolver documentado.

### 8. Exceções globais permanecem explícitas

- Home pode agregar projeções públicas de várias campaigns;
- Lembra permanece biblioteca compartilhada; classificação por campaign é metadata opcional e não vira authorization boundary;
- lore standalone pode continuar sem campaign; vínculo editorial é opcional e não muda sua URL automaticamente.

### 9. Rollout é aditivo e faseado

A evolução segue:

1. schema preparado;
2. app compatível com context/aliases;
3. backfill da campaign existente;
4. ativação de segunda campaign;
5. rotas canônicas campaign-aware;
6. remoção de hardcodes;
7. depreciação de compatibilidade somente com prova de ausência de consumidores.

Rollback de qualquer fase preserva dados criados e não apaga campaigns para simular retorno ao estado anterior.

## Consequências

### Positivas

- elimina dependência estrutural de campanha única;
- permite IDs iguais em campaigns diferentes quando o domínio permitir;
- separa rename editorial de identidade técnica;
- deixa RBAC e Media Storage estáveis diante de mudança de URL/nome;
- torna testes cross-campaign objetivos e repetíveis.

### Custos

- consumidores precisam carregar/derivar campaign context;
- compatibilidade de rotas exige alias/redirect deliberado;
- caches e idempotency keys precisam incorporar campaign;
- superfícies agregadas precisam projetar campaign name/route key sem ampliar audience.

## Não decisões

Esta ADR não:

- aplica migration em Production;
- define UI final do diretório de campaigns;
- cria sessão/entity/canon para **Antes que seja tarde**;
- transforma lore D em campaign-owned automaticamente;
- escolhe namespace físico final de mídia além de exigir identidade estável;
- cria role por campaign.

## Referências

- [Multi-campaign — contrato, rotas e rollout](../architecture/multi-campaign.md)
- [Modelo de dados](../data-model.md)
- [Identidade e autorização](../domains/identity-access.md)
- [Campanhas e sessões](../domains/sessions.md)
- [ADR-0008 — capabilities](0008-capability-authorization.md)
- #1122
- #1123
- #1134
- #1137
- #1138
