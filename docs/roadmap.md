# Roadmap

> Status: vigente
> Owner: produto / arquitetura
> Última revisão: 2026-09-07
> Fonte de verdade: `Faysk/tda@main`, `feature-catalog.md` e documentos donos; PRs/issues apenas para estágio de candidato

O roadmap é incremental. Cada etapa precisa preservar dados, autorização e documentação viva. O legado continua disponível como referência histórica/compatibilidade documentada até o reboot comprovar independência do comportamento necessário.

Os estados dos marcos abaixo descrevem a **`main` atual**. Uma implementação em PR aberta pode estar validada e ainda assim continuar fora da `main` e de production. Estágio de entrega segue a taxonomia de [Documentação viva](documentation/README.md).

## Ordem de consolidação

A prioridade editorial e de integração é:

1. **Home, sessões e contrato público** — estabilizar navegação, metadata, mídia e critérios de release sem confundir código integrado com publicação;
2. **Edit e transcrições** — fechar Auth/capabilities, persistence concorrente/auditável e UX do primeiro fluxo crítico antes de expandir administração;
3. **novas features narrativas** — Lore/perfis, World Explorer, relations e demais superfícies entram depois dos dois boundaries anteriores e reutilizam os contratos compartilhados.

Design System/Brand Pack, segurança, documentação viva, custo gratuito/Hobby quando possível e processamento pesado local são invariantes transversais, não uma desculpa para furar essa ordem.

## Snapshot de coordenação — candidatos abertos em 2026-09-07

Este quadro **não substitui os documentos donos nem promove PR aberta a estado vigente**. Serve somente para tornar dependências explícitas no ponto de coordenação observado com `main` em `3e3c2dcb98a30ef28a1d4bbc6b5ce76ad1d66efc`.

| Área | Estado vigente na `main` | Candidatos/dependências abertas | Gate antes de avançar o estado canônico |
| --- | --- | --- | --- |
| público / metadata / mídia | Home e sessões públicas existem; contrato operacional de preview/crawler da #46 está integrado; R2 público continua sem entrega pública ativa | #47 implementa metadata SSR/fallback e mídia social verificada; issue #25 continua aberta; #49 recupera 22 imagens em dry-run validado, sem upload/public delivery | #47 pode continuar segura com fallback; artwork de sessão só pode ser promovida após evidência pública real da #25/#49; merge ainda não é release |
| Auth / login | schema/RBAC e boundaries server-side de transição existem, mas não há login Discord oficial integrado | #43 é contrato/ADR candidato; #48 é implementação Discord SSR/guards e correção runtime de scope; OAuth real/callback de ambiente ainda não foi comprovado | reconciliar ownership #43/#48, integrar apenas SHA final validado e verificar OAuth real no ambiente autorizado antes de declarar publicação |
| Edit / transcript | workbench temporário da #29 está na `main` mas desligado por default; #33/#34 integraram `revision` e sua leitura autorizada | issue #32 continua aberta; #44 contém RPC/migration atômica candidata não aplicada; #39 contém UX de conflito/retry; #48 fornece Auth/guards candidatos | integrar e aplicar deliberadamente #44 pelo runbook, verificar remoto; depois ligar adapter Auth/Edit ao RPC e à state machine; só então retirar `TDA_EDIT_UNSAFE` em recorte próprio |
| metadata compartilhada / World / Lore | contratos arquiteturais de World e perfis existem; nenhuma das implementações abaixo está na `main` | #47 é dependência compartilhada; #45 é draft/stack de World e ainda está baseada em head anterior da #47; #26 é draft de Lore e aguarda o helper central + conteúdo/projection autorizados | após estabilizar #47 na base canônica, retarget/reconciliar #45 e revalidar SHA; #26 deve consumir o helper central sem duplicá-lo e continuar sem publicar fixture/conteúdo não autorizado |

Detalhes operacionais da recuperação de mídia pertencem à #25/#49 e a `docs/integrations/r2.md`; configuração de login pertence ao owner de identity/access; SQL/aplicação do Edit pertence ao owner de banco; metadata SSR pertence ao owner de hosting/metadata. Este roadmap não replica essas auditorias.

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
- migração física das imagens para R2 pendente;
- homologação/deploy apenas na Vercel correta.

Auth não é requisito para leitura pública; sua convergência pertence ao R3. A próxima release pública deve seguir os gates de navegação/metadata do runbook e registrar o SHA realmente publicado.

## R2.1 — Design System e Brand Pack oficiais

**Estado:** documentação/contrato aprovados; integração física parcial.

Objetivo: manter o frontend sobre o **TDA Design System v1.0.0** e o **TDA Brand Pack (official)** fornecidos pelo proprietário, avançando de forma incremental sem reescrever superfícies por big bang.

Entregas:

- tokens semânticos `--ds-*`;
- tipografia editorial + UI;
- primitives compartilhadas;
- assets oficiais em `public/brand/`;
- favicon/manifest/OG oficiais conforme o owner de marca;
- light/dark equivalentes;
- checklist visual e acessibilidade.

Regra:

> Visitante vê história; editor vê estado editorial.

## R2.2 — World Explorer / Ecos da Jornada — vertical slice

**Estado na `main`:** arquitetura aprovada; implementação não integrada.

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

O candidato visual está na PR #45, mas permanece draft e dependente do contrato central de metadata da #47. Isso não muda o estado canônico desta seção até integração.

A referência visual oficial está em `docs/design-system/world-explorer-ui.md`.

## R3 — Auth, capabilities e Edit integrado

**Estado na `main`:** arquitetura do Edit aprovada; implementação incremental em andamento; login oficial e persistence canônica ainda não integrados.

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
2. manter leitura autorizada com `revision` real;
3. fechar e aplicar mutation server-side atômica com auth/capability/campaign scope, optimistic concurrency e audit;
4. ligar transcript read/edit ao boundary canônico;
5. integrar UX de conflito/retry e navegação por teclado sem criar write paralelo;
6. retirar o bypass temporário somente após convergência validada;
7. expandir para review/bulk, gestão de acesso, conteúdo/mídia/auditoria.

A documentação canônica do módulo está em `docs/features/edit-workbench.md`, `docs/features/edit-transcript-server-slice.md`, `docs/architecture/edit-workbench.md`, `docs/legacy/edit-parity.md` e ADR-0007. A issue #32 coordena o caminho restante de persistence; PRs abertas citadas no snapshot são candidatas, não runtime vigente.

Regras:

- publishable key no browser, secret somente server-side;
- autorização por capability, não por string de role na UI;
- validar token no servidor para decisões privilegiadas;
- scope canônico conceitual do reboot: projeto `tda`; representação física precisa seguir o owner de identity/access;
- scope `dnd-scribe` permanece apenas por compatibilidade enquanto houver consumidor documentado;
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

O site deve continuar funcionando com o PC desligado sobre conteúdo sincronizado. Processamento pesado e retenção bruta continuam locais; R2 não vira arquivo obrigatório de áudio.

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

**Estado na `main`:** arquitetura aprovada; dados/população e implementação integrada pendentes.

Criar páginas de leitura para:

- personagens;
- NPCs;
- lugares;
- facções;
- músicas;
- quests.

As rotas são tipadas para UX, mas resolvem sobre `entities`. A PR #26 é um scaffold draft, não conteúdo publicado; continua dependente de projection/canon/assets autorizados e do contrato compartilhado de metadata.

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
- `main = Production` em termos de linha de código aceita, mas não dispara deploy automático;
- merge de migration não significa aplicação no Supabase;
- deploy é publicação controlada, nunca ferramenta de desenvolvimento;
- cloud deve permanecer nas franquias gratuitas/Hobby quando possível, sem habilitar serviço pago por conveniência;
- processamento pesado e áudio bruto permanecem locais.

O contrato dos conceitos está em [data-model.md](data-model.md), o estado canônico das features em [feature-catalog.md](feature-catalog.md), a taxonomia de entrega em [documentation/README.md](documentation/README.md) e as decisões estruturais em [adr/README.md](adr/README.md).
