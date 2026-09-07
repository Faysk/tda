# Roadmap

> Status: vigente
> Owner: produto / arquitetura
> Última revisão: 2026-09-07

O roadmap é incremental. Cada etapa precisa preservar dados, autorização e documentação viva. O legado continua disponível como referência e operação temporária até o reboot comprovar independência.

## R1 — Fundação

**Estado:** concluída na base do reboot.

Inclui:

- repositório `Faysk/tda`;
- CI sem deploy automático;
- Next/React atuais do projeto;
- leitura Supabase existente;
- integração R2 preparada;
- política Vercel controlada;
- documentação modular e ADRs.

## R2 — Site público: Home, sessões e resumos

**Estado:** em consolidação/homologação.

Inclui:

- Home;
- arquivo de sessões;
- resumos completos com renderer seguro;
- mídia de sessão com origens legadas aprovadas durante transição;
- detalhe de sessão;
- navegação anterior/próxima;
- metadata/SEO;
- temas light/dark/system;
- compatibilidade de URLs antigas;
- mobile/acessibilidade;
- autenticação foundation pendente de conclusão;
- migração física das imagens para R2 pendente;
- homologação/deploy apenas na Vercel correta.

Só publicar após aceite do recorte.

## R2.1 — Design System e Brand Pack oficiais

**Estado:** documentação/contrato aprovados; integração física pendente.

Objetivo: migrar o frontend do conjunto visual provisório para o **TDA Design System v1.0.0** e **TDA Brand Pack (official)** fornecidos pelo proprietário.

Entregas:

- tokens semânticos `--ds-*`;
- tipografia editorial + UI;
- primitives compartilhadas;
- assets oficiais em `public/brand/`;
- favicon/manifest/OG oficiais;
- light/dark equivalentes;
- checklist visual e acessibilidade.

Regra:

> Visitante vê história; editor vê estado editorial.

A migração deve ser gradual, com aliases temporários para tokens antigos quando necessário.

## R2.2 — World Explorer / Ecos da Jornada — vertical slice

**Estado:** arquitetura aprovada; implementação pendente.

Objetivo: validar a experiência visual de memória conectada antes de persistir um grande catálogo de relations.

Decisões já fechadas:

- React Flow (`@xyflow/react`) como engine de visualização;
- domínio independente da biblioteca;
- custom nodes/edges;
- layout radial próprio;
- entity focada no centro;
- 1-hop default e 2-hop opcional;
- inspector lateral desktop;
- bottom sheet mobile;
- lista alternativa acessível;
- nenhum dado secreto enviado para o browser;
- nenhuma escrita em relations pelo canvas público.

Primeiro slice:

- Dandelion como foco de demonstração;
- fixtures explicitamente não canônicas quando necessário;
- PC/NPC/location/faction/song/moment nodes suficientes para validar a composição;
- filtros, busca local/contextual e perfil rápido;
- deep link para perfil editorial.

A referência visual oficial está em `docs/design-system/world-explorer-ui.md`.

## R3 — Auth, capabilities e Edit integrado

**Estado:** auth foundation iniciada; arquitetura do Edit aprovada; implementação incremental iniciada.

Objetivo:

- login único;
- sessão/perfil;
- capabilities derivadas do RBAC;
- workbench administrativo integrado;
- revisão/publicação;
- catálogo de mídias;
- criação/edição de sessões;
- gestão de entities/canon conforme autorização.

Primeira sequência do Edit:

1. consolidar contrato, paridade do legado e boundary técnico;
2. extrair regras puras de edição de transcript com testes;
3. fechar mutation server-side com auth/capability/campaign scope;
4. implementar transcript read/edit no workbench;
5. adicionar review/bulk e navegação por teclado;
6. implementar gestão de acesso;
7. expandir para conteúdo/mídia/auditoria.

A documentação canônica do módulo está em `docs/features/edit-workbench.md`, `docs/architecture/edit-workbench.md`, `docs/legacy/edit-parity.md` e ADR-0007.

Regras:

- publishable key no browser, secret somente server-side;
- autorização por capability, não por string de role na UI;
- validar token no servidor para decisões privilegiadas;
- scope canônico do reboot: `tda`;
- scope `dnd-scribe` permanece apenas por compatibilidade até aposentadoria do legado;
- comportamento útil do legado só é considerado migrado após paridade, teste e autorização;
- autosave precisa tratar concorrência explicitamente.

## R4 — Operação local modernizada

**Estado:** planejado.

Modernizar a transcrição pesada preservando o fluxo local que já funciona.

Objetivos:

- ingest retomável;
- jobs idempotentes;
- comparação qualidade/tempo/memória;
- áudio bruto sem retenção cloud permanente;
- sincronização autenticada;
- retries;
- deduplicação;
- observabilidade suficiente para operação real.

O site deve continuar funcionando com o PC desligado sobre conteúdo sincronizado.

## R5 — Memória estruturada

**Estado:** schema parcialmente preparado.

Popular, somente a partir de conteúdo revisado:

- `entities`;
- `entity_mentions`;
- `canon_entries`;
- aliases;
- summaries editoriais;
- links com sessões/evidências.

PCs e NPCs usam a mesma registry canônica. `profile` é pessoa/conta; `participant` é ocorrência numa sessão.

## R5.1 — Perfis editoriais

**Estado:** arquitetura aprovada; dados/população pendentes.

Criar páginas de leitura para:

- personagens;
- NPCs;
- lugares;
- facções;
- músicas;
- quests.

As rotas são tipadas para UX, mas resolvem sobre `entities`.

Dandelion será o primeiro perfil de vertical slice junto do World Explorer.

## R6 — Relations first-class

**Estado:** contrato proposto; migration não aplicada.

Modelar edges entre entities com:

- tipo;
- direção/simetria;
- lifecycle;
- temporalidade;
- visibility;
- fontes em canon aprovado;
- auditabilidade;
- queries 1-hop indexáveis.

Fluxo:

```text
evidence -> candidate/review -> canon -> entity_relation
```

Não gerar relation canônica por coocorrência ou IA sem revisão.

Após migration/testes de audience, ligar o World Explorer aos dados reais.

## R7 — Knowledge, audiência e segredos

**Estado:** em desenho.

Separar duas dimensões:

1. quem pode ver o dado no produto;
2. quem sabe/acredita no dado dentro da ficção.

Modelar quando a semântica estiver fechada:

- conhecimento do personagem;
- conhecimento do jogador;
- conhecimento público;
- segredo do DM;
- rumor;
- mentira;
- suspeita;
- memória esquecida/roubada/restaurada;
- estado contestado.

A própria existência de uma relation pode ser segredo.

## R8 — Exploração avançada

**Estado:** planejado após memória/relations/knowledge.

Inclui:

- timeline por entity;
- busca semântica source-aware;
- mapas narrativos;
- performances/músicas;
- quests/ganchos;
- rumores;
- previously-on;
- perspectivas player/DM;
- assistente Discord;
- export de memória para LLM;
- galerias e demais superfícies derivadas.

## Regras transversais

- transcrição/evento não vira canon automaticamente;
- fixture visual não vira relation canônica;
- IA sugere, humano revisa;
- secrets/audience são filtrados antes do browser;
- Brand Pack não é redesenhado;
- React Flow não define schema;
- features novas entram primeiro na documentação/contrato;
- DDL real exige migration versionada;
- `main = Production` em termos de código aceito, mas não dispara deploy automático;
- deploy é publicação controlada, nunca ferramenta de desenvolvimento.

O contrato dos conceitos está em [data-model.md](data-model.md), o estado das features em [feature-catalog.md](feature-catalog.md) e as decisões estruturais em [adr/README.md](adr/README.md).