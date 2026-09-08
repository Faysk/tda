# Inventário de entregas

> Status: vigente
> Owner: Prancheta - Organização de entregas
> Última revisão: 2026-09-08
> Fonte de verdade: GitHub para PR/SHA/checks; documentos donos para contrato; evidência operacional específica para integração/publicação

Este é o **único registro operacional de status das entregas**. Roadmap define prioridade e direção de produto; documentos donos definem contrato; Lupa mantém auditoria independente; deployments registra publicação. Não copiar esta tabela para roadmap, índices ou relatórios paralelos.

## Estado operacional observado

- `main` verificada nesta revisão: `80eab3a8c267e3e3900cd7c9399f23bf914d994d`.
- O histórico de [deployments](../operations/deployments.md) preserva Production #006, source `7dd4b06d1a246ad924230530c2a0424e830aa46d` e deployment `dpl_8cS1DGKStTdmos27wYoa747JRZ6a` como **evidência histórica daquela publicação**. Esse registro, sozinho, não confirma o SHA servido agora.
- A observação de health mais recente informada para a produção retornou `commit=null`; portanto este inventário **não declara um source SHA atualmente ativo** sem recibo runtime adicional que faça essa associação.
- AUTH, STATS, consulta de PERMISSOES e LOCAL possuem evidências operacionais históricas já registradas; isso não autoriza inferir que qualquer mudança posterior na `main` foi publicada automaticamente.
- IMPORT #61 está integrada no repositório; ativação externa, migrations e grants continuam gates separados. Merge de migration nunca é prova de aplicação no Supabase.
- MIDIA #54 permanece preparação integrada; upload, promoção de referências e deployment continuam operações deliberadas e separadas.
- A prioridade de produto da rodada #99 é **P1 Pipipi oficial -> P2 dados reais revisados -> P3 edição autorizada do grafo**. Frentes de Edit, operação local, sync, mídia e Auth continuam paralelas e mantêm seus próprios gates/evidências.

## Rodada coordenada #99 — lore, curadoria e grafo

A issue [#99](https://github.com/Faysk/tda/issues/99) coordena três resultados relacionados, mas **não muda sozinha o estágio de entrega de nenhum deles**. Cada frente continua no documento dono e só avança neste inventário com PR/SHA/evidência próprios.

- **P1 — PIPIPI / Pipoca:** tornar Pipipi a lore pioneira oficial em `/lore/pipipi`, reutilizando o Presentation Engine de [perfis editoriais](../features/entity-profiles.md), [Design System](../design-system/README.md), componentes/tokens vigentes e metadata pública central. Estrutura cinematic é referência opcional; parallax deve ser adaptado como enhancement e nunca bloquear leitura estática, mobile, reduced motion ou acessibilidade. O trabalho local e as sete imagens preparadas são dependências conhecidas; não há nesta linha evidência suficiente para declarar rota integrada, CI final ou publicação.
- **P2 — CURADORIA / Fabuloso:** responsável confirmado pela curadoria de resumos/transcrições e demais fontes reais sem copiar material privado para docs/issues. O resultado precisa preservar provenance, distinguir fato explícito/inferência/conflito, registrar estado de revisão e visibility antes de qualquer promoção. Owners: [evidence](../domains/evidence.md) + [canon/review](../domains/canon-review.md). Candidato revisável não é canon nem publicação.
- **P3 — GRAFO / Espaguete:** consumir somente projections de dados reais revisados/permitidos e preparar edição autorizada. Mover node altera layout editorial; editar relação/fato é operação narrativa separada, com fonte, revisão, visibility, capability/scope server-side, concorrência e recuperação de erro. Owners: [World Explorer](../features/world-explorer.md) e [relations](../features/relations-data-contract.md). O drift operacional de layout permanece acompanhado pela #95 e não deve ser mascarado por esta rodada.
- **ACESSO / Crachá + Chaveiro:** mapear capabilities existentes para layout, conteúdo e publicação; login não cria grant implícito. Qualquer mutation precisa de validação server-side no boundary dono.
- **PUBLICAÇÃO / Foguete + Marreta + Balde:** publicação de Pipipi é deliberada e posterior a revisão, CI, desktop/mobile, mídia/OG e leitura pública verificadas. Merge ou URL planejada não equivalem a publicação.

Dependência documental: Prancheta mantém **somente o estágio/evidência** aqui; [roadmap](../roadmap.md) registra prioridade P1/P2/P3 e os documentos donos preservam os contratos. Não criar spec paralela da #99 nem copiar transcrição, relação secreta ou IDs privados para fixtures/documentação pública.

## Corte histórico inicial

- `main`: `d89b954d9b35de3e90452a83b5b66cf79fab322b`.
- #59 está integrada à `main`.
- #54, #55, #56, #57, #58, #60 e #61 permanecem abertas no corte recebido.
- os checks atuais informados dessas PRs estão verdes; #61 foi reconfirmada no head `5590c11987d5faea390140dcb7bce752dd89415b`.
- publicação da correção AUTH está sendo conduzida por Polvo; Prancheta não executa deploy paralelo.
- #62 está fechada sem merge e permanece apenas como histórico/superseded da tentativa SQL concorrente.
- trabalho parcial de PIPIPI, CINEMA, GRAFO e EDIT foi preservado; estado novo após migração dos chats não foi fornecido neste corte.

Uma mudança de head invalida somente as provas dependentes daquele SHA. CI verde prova o escopo executado pelo workflow, não integração, OAuth real, aplicação de migration, configuração remota nem publicação.

## Quadro histórico do corte inicial

A tabela abaixo conserva o corte `main@d89b954`; não representa o estado corrente descrito no topo. As evidências e pendências referem-se àquele corte.

`Bloqueado` é marcador, não coluna separada. `não disponível` significa ausência de evidência atual no corte e nunca deve ser convertido em conclusão.

| ID | Resultado / frente | Dono | Marco / prioridade | Coluna no corte | PR / SHA | Evidência de testes | Integração | Publicação / aplicação | Dependências, bloqueios e próximo gate | Estimado | Observado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MIDIA | preparação de mídia/lore e CAS futuro | Balde | M0 / preservar público | Em validação/revisão | #54 `46a16d1ec811b3c36413206e0527a9166a0854c5` | CI atual success; dry-run e testes de escopo/SVG registrados na PR | não integrada | nenhum upload/CAS/deploy deste recorte | decisão de integração; qualquer operação R2/CAS continua separada e deliberada | ausente | ausente |
| DOCS | coordenação documental da rodada e Production #004 | Rabisco | transversal; prioridade no roadmap | Em validação/revisão | #55 `ea5fb59b7ed4aa2b130fbd16a7912881a219e8e2` | CI atual success | não integrada | não aplicável ao recorte docs; recibos operacionais permanecem nos documentos donos | reconciliar snapshot após #59 e demais integrações; regenerar catálogo sobre base final | ausente | ausente |
| STATS | estatísticas autorizadas de transcrição | Contador de Feijão | auxiliar de M2 | Em validação/revisão | #56 `88ae8534dcdb3966e694665653ed7d4156fb6d66` | CI atual success; check/build/E2E e suíte específica registrados | não integrada | não publicada | revisão e reconciliação de `/conta`/config com lote final | ausente | ausente |
| SERVICO | companion local durável | Motorzinho | M2 / caminho crítico local | Em validação/revisão | #57 `a5cad8345519b0e82c267b66711577332301d71f` | Companion Windows/Linux e CI web success; wheel/fixture sintética registrados | não integrada | sem instalação persistente/deploy | ASR real, installer/ACL e integração de receipt são gates posteriores; não confundir fixture com transcrição real | ausente | ausente |
| LOCAL | painel de processamento local | Painelzinho | M2 / caminho crítico local | Em validação/revisão | #58 `fe7ca852a3ead4f7ed4c0f738dec2733c1de6ee6` | CI atual success; browser e integração sintética com #57 registrados | não integrada | sync continua sem publicação/ativação comprovada | preservar integração com SERVICO; receipt/retry real depende de IMPORT; reconciliar arquivos compartilhados | ausente | ausente |
| AUTH | correção do início de login/logout Discord | Catraca | M1 / acesso | Integrado/aguarda publicação | #59 `8d0c93c91b5a9295240ab71e9374de5e3a1e688e`; main `d89b954d9b35de3e90452a83b5b66cf79fab322b` | CI do head success; testes de clique real/origin registrados | integrada à main | publicação em curso por Polvo; recibo final não disponível neste corte | não duplicar deploy; após publicação provar fluxo completo OAuth/callback/profile/capabilities/logout | ausente | ausente |
| PERMISSOES | consulta administrativa read-only por campanha | Chaveiro | M1 / acesso administrativo | Em validação/revisão | #60 `ac7471c8205f6ce1dc41b013abad317467510e78` | CI atual success; check/build/E2E específicos registrados | não integrada | não publicada; nenhuma mutation/grant | reconciliar `policy.ts`, `/conta` e catálogo com LOCAL/IMPORT; concessão/revogação permanece fora do escopo | ausente | ausente |
| IMPORT | importação durável e receipt da transcrição local | Carteiro | M2 / caminho crítico | Em validação/revisão | #61 `5590c11987d5faea390140dcb7bce752dd89415b` | CI `34159514011` terminal success no head atual, incluindo gates web/PostgreSQL do workflow | não integrada | nenhuma migration/grant/deploy aplicada por esta frente | revisão de contrato/SQL e ensaio conjunto SERVICO+LOCAL+IMPORT+EDIT; Auth/PostgREST real e aplicação deliberada são gates separados | ausente | ausente |
| PIPIPI | lore real Pipipi | Pipoca | M3 / narrativa | não disponível após migração | PR/SHA atual não disponível; checkpoint anterior preservado | evidência parcial histórica existe, mas resultado atual não foi fornecido | não disponível | não publicada neste corte | dono confirmar checkpoint/branch/artefato antes de retomar; não reconstruir conteúdo nem inferir canon | ausente | ausente |
| CINEMA | cinematic opcional | Claquete | M4 / melhoria narrativa | não disponível após migração | PR/SHA atual não disponível; checkpoint anterior preservado | testes/artefatos atuais não disponíveis | não disponível | não publicada | preservar leitura sem efeito, reduced motion e referência não canônica; dono confirmar checkpoint | ausente | ausente |
| GRAFO | evolução do World Explorer/grafo | Espaguete | M4 / relações | não disponível após migração | PR/SHA atual não disponível; checkpoint anterior preservado | testes/artefatos atuais não disponíveis | não disponível | não publicada | projection/canon e permissões continuam contratos donos; dono confirmar checkpoint antes de retomar | ausente | ausente |
| EDIT | integração do Edit com persistence canônica | Parafuso | M2 / caminho crítico | não disponível após migração | PR/SHA atual não disponível; checkpoint anterior preservado | evidência atual não disponível | não disponível | não publicada/aplicada | depende de acesso e contrato final de persistence/import; preservar revision/conflito/audit e trabalho existente | ausente | ausente |
| AUDIT | auditoria independente das entregas | Lupa | transversal | função de revisão; não conta como entrega/WIP por si só | não aplicável | achados vivem na auditoria dona; não duplicados aqui | não aplicável | não aplicável | Prancheta referencia achado necessário na linha afetada; Lupa mantém auditoria detalhada | ausente | ausente |
| DB | revisão do contrato de banco/migrations | Cofrinho | transversal / gate M2 | função de revisão; não conta como entrega/WIP por si só | PR própria atual não disponível | evidência pertence às PRs SQL e revisão do contrato | não aplicável isoladamente | nenhuma aplicação inferida | decidir contrato único, ordem de migrations e aceite antes de qualquer DDL/grant remoto | ausente | ausente |

## Histórico relevante sem cartão ativo

| Referência | Estado | Motivo |
| --- | --- | --- |
| #62 `b3f64e3461cf47c4f9ad578354b5cbd1ed69db34` | encerrada/substituída; fechada sem merge | candidata SQL concorrente de IMPORT; não integrar nem aplicar junto da #61 |

## Arquivos compartilhados que exigem reconciliação

Antes de qualquer lote, conferir pelo menos:

- `docs/documentation/catalog.md`: gerado e tocado por várias PRs; regenerar sobre a base final, nunca resolver manualmente;
- `docs/README.md`: esta frente adiciona o índice de entregas e #58 também possui alteração pendente; preservar ambos;
- `src/app/conta/page.tsx`: STATS, LOCAL e PERMISSOES possuem alterações concorrentes;
- `src/features/edit/access/policy.ts`: LOCAL, PERMISSOES e IMPORT precisam preservar todas as capabilities/helpers;
- `.github/workflows/ci.yml`, `package.json` e configs Playwright: reconciliar antes de declarar combinação validada;
- `docs/operations/discord-auth.md`: DOCS e AUTH precisam refletir estado final sem transformar integração em OAuth/publicação comprovados.

## Candidato no corte histórico inicial

Não existe novo SHA composto congelado por Prancheta neste corte.

AUTH já está integrado e possui operação de publicação conduzida externamente por Polvo; isso **não autoriza outro deploy** desta frente. O recibo final de publicação/smoke deve ser ligado à linha AUTH quando disponível.

Demais recortes só viram candidato após composição explícita conforme `release-candidate.md`: base + heads congelados, reconciliação, CI do conjunto, Preview/ensaio aplicável, escopo aprovado e rollback conhecido.

## Regra de atualização

Atualizar uma linha apenas por evento factual:

`data UTC | ID | de → para | motivo | PR/SHA/evidência | próximo responsável`

Novo SHA reabre gates dependentes dele. CI verde não move automaticamente para integração. Merge não move automaticamente para publicação. Migration integrada não move automaticamente para aplicada. Ausência de informação vira `não disponível`.

## Atualização operacional — integração #64

- Main verificada: `7dd4b06d1a246ad924230530c2a0424e830aa46d`.
- STATS (#56), PERMISSOES (#60), SERVICO (#57) e LOCAL (#58) foram integradas via #64, preservando os heads acima. As quatro PRs estão mergeadas. A tabela anterior é o corte histórico, não a fila atual.
- Candidato composto `dca0db99064ee10243489540a623c7e4434c747b`: CI web e Companion Windows/Linux success. Check/build/E2E conjuntos locais, 11 testes Python e 2 ensaios browser com supervisor real scratch aprovados.
- CI do merge main em andamento no momento deste registro; nenhuma publicação desse lote inferida.
- AUTH #59 foi publicado no Production #005: `dpl_EtY2oqVJ9hdNwRS5qRMZt4q19EHt`, source `d89b954d9b35de3e90452a83b5b66cf79fab322b`. Consentimento Discord real retornou ao site; leitura de acesso dependia da flag Production `TDA_READ_EDIT_DATA`, salva para próximo deployment. Consulta/reload/logout posteriores ainda são gate.
- IMPORT #61 permanece separada: revisão SQL solicitada a Cofrinho; Carteiro entregou proposta de ligação do envelope ao client/receipt. Serviço sintético não produz conteúdo importável; ASR real e ativação seguem pendentes.
- PIPIPI, CINEMA, GRAFO e EDIT: checkouts locais foram inventariados e documentação entregue aos chats responsáveis. Código central de Pipipi/Edit fornecido para revisão; não são features publicadas.
- Prancheta recebeu os quatro rascunhos integrais e devolveu patch incremental aplicado a este candidato documental. Sem métricas de esforço inventadas.
