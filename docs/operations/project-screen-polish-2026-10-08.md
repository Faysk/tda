# Auditoria e polimento das telas — 2026-10-08

> Status: candidato em validação; publicação pendente
> Owner: frontend / ux / operations
> Última revisão: 2026-10-08
> Fonte de verdade: epic #1601, issues vinculadas e receipts de validação

## Escopo e limites

Esta rodada sucede o aceite de Processing em main@efa5073a7972. O inventário automatizado identifica 55 páginas App Router, 11 superfícies especiais e 6 documentos standalone. Rotas dinâmicas são revisadas por família, com conteúdo real quando existente e fixtures sintéticas para estados vazios, falhas, permissões e variações ausentes em Production. Não se inventam dados para preencher catálogos vazios.

A inspeção real usa Chrome autenticado, geometrias do DOM e screenshots. Testes locais usam dados sintéticos e o build de produção. Esses resultados são evidências distintas: testes não comprovam implantação, decisão editorial ou suporte a hardware não utilizado. Nenhuma transcrição privada, imagem privada, áudio, credencial ou fonte narrativa é registrada no GitHub ou neste documento.

## Matriz de superfícies

| Família | Telas e estados revisados | Evidência / encaminhamento |
| --- | --- | --- |
| Home e shell | Hero publicado, launcher, drill-down de Mundo, ferramentas capability-aware, aparência, foco/teclado, loading e navegação | Chrome real + global-navigation/layout/feedback gates; identidade cinematic preservada |
| Campanhas | Diretório, overview de ambas as campanhas, seleção e campanha inexistente | Contexto do diretório oculto pelo logo no celular: #1603; fallback editorial vazio é estado válido |
| Sessões públicas | Arquivo agregado/scoped, busca/filtros, detalhe publicado e navegação de seção | Chrome real + session-public-layout/product-coherence gates; conteúdo publicado significativo conferido |
| Mundo e entidades | Explorer, catálogo e perfil de personagem; NPCs, lugares, facções, quests e músicas | Chrome real + World/catalog fixtures; zero itens publicados não é tratado como erro |
| Lore | Catálogo, Astel, Noah, Pipipi, Seika, D e Yllith; cinematic/leitura/retorno/fragmentos | Identidades próprias preservadas; overflow de Astel somente a 320 px: #1607 |
| Diário | Catálogo, livro de Astel e leitura contínua | Chrome real + standalone/diary gates |
| Identidade e Lembra | Entrada, conta/acesso, biblioteca compartilhada e estados de identidade | Chrome real + auth/account/Lembra fixtures; sem logout, novos grants ou novas credenciais |
| Edit | Registro de campanhas, biblioteca, editor e abas Transcrição/Sessão/Resumo-Preview | Chrome real com leitura; nenhuma transferência de campanha, edição narrativa ou publicação disparada |
| Ferramentas privadas | Transcrições, Revisão, Permissões e Edit Mundo | Endereços públicos rejeitados: #1604; longa fila sem busca/páginas: #1605 |
| Processing | Visão geral, Fila, Resultados, Benchmark, Diagnóstico e passagem privada ao Edit | Aceite anterior preservado; regressão de navegação/layout incluída nesta rodada |
| Estados transversais | Empty, no-match, unavailable, forbidden, not-found, pending, reduced motion e zoom/reflow | Fixtures automatizadas; não induzir indisponibilidade do banco de Production para testar erro |

## Correções candidatas

- #1603: reserva vertical baseada nos tokens do chrome para o primeiro contexto público; remoção do override mobile que anulava a reserva. Sem barra estrutural ou scrim pesado.
- #1604: tradução do public_slug apenas dentro das campanhas autorizadas; APIs, ações, grants e consultas mantêm o technical slug. Launcher usa o nome público para todas as ferramentas; compatibilidade técnica preservada. Nenhuma migration ou ampliação de autorização.
- #1605: pesquisa sem acentos e filtro de tipo sobre o conjunto carregado, 20 candidatos por página, contagem/limpeza/no-match, navegação superior e inferior, ajuda recolhível. A consulta continua limitada a 200; a interface explica essa limitação sem declarar o backlog inteiro.
- #1607: filhos do grid de origem de Astel podem encolher e títulos longos podem quebrar. Sem alterações em pinturas, proporção, identidade ou referências de Media Storage.
- #1608: o botão de título do Lembra mantém uma caixa block estável; o clamp visual de duas linhas fica no texto filho. Nome acessível completo, foco e abertura por teclado preservados.

- #1609: Escape consumido pelo seletor interno não fecha o menu da conta. O primeiro Escape devolve foco ao seletor; o segundo fecha o menu e devolve foco ao launcher.

## Entrega e rollback

As evidências finais de checks, build, browser, CI, merge e Production pertencem às issues e ao receipt desta entrega. Não fechar os itens apenas com implementação local. O pipeline production-cd exige despacho deliberado do SHA atual de main após validação do escopo.

Rollback: reverter os commits de apresentação/routing pelo fluxo normal e publicar um SHA validado. Não há DDL, novo provider, mídia substituída, mudança de grants ou mutação narrativa para desfazer. A correção não amplia o contrato de aliases históricos de public_slug.
