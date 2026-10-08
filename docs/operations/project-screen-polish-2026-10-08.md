# Auditoria e polimento das telas — 2026-10-08

> Status: registro da rodada; entregas e aceites vinculados ao epic #1601
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

- #1611: a abertura dos diálogos de campanha e do composer do Lembra estabelece foco inicial junto com showModal, sem callback atrasado que possa capturar a digitação do campo seguinte.
- #1612: o teste de proporção seleciona a imagem pelo botão visível e file chooser, preservando as verificações de composer, galeria e viewer. A falha de setup não comprova perda de imagem em Production.

## Entrega e rollback

As evidências finais de checks, build, browser, CI, merge e Production pertencem às issues e ao receipt desta entrega. Não fechar os itens apenas com implementação local. O pipeline production-cd exige despacho deliberado do SHA atual de main após validação do escopo.

Rollback: reverter os commits de apresentação/routing pelo fluxo normal e publicar um SHA validado. Não há DDL, novo provider, mídia substituída, mudança de grants ou mutação narrativa para desfazer. A correção não amplia o contrato de aliases históricos de public_slug.

## Consistência de fila — #1614

A investigação do gate de isolamento demonstrou uma corrida real entre a seleção de jobs e sua contagem. O teste determinístico intercala um cancelamento persistido: antes da correção, uma linha ativa é devolvida com `total_matching=0`; depois, a leitura transacional devolve registros e contadores do mesmo snapshot. O parser Web permanece estrito. O payload original da falha de CI não foi capturado; ligar aquela ocorrência à corrida demonstrada permanece uma inferência.

O candidato Companion 0.3.26 exige release e aceite instalado; a publicação Web não atualiza o Agent 0.3.25 já instalado. Seis testes de paginação e dez casos de browser scratch passaram localmente. Suite completa, CI e release são etapas separadas e permanecem vinculadas à issue. Não há mudança em ASR, schema local, configuração de journal, dados ou runtimes de GPU. Rollback preserva o diretório de dados e reinstala a release anterior, reintroduzindo a corrida.

## Aceite publicado e landmarks — #1618

As correções Web iniciais foram publicadas em `prod-620b11f4fc5a` (CD #37721017153).
O Chrome conferiu as rotas privadas pelos nomes das duas campanhas e o contexto
móvel do diretório. Essa inspeção também confirmou um main interno ao main global
no diretório. #1618 corrige o contrato para manter `main#conteudo` como único dono
do conteúdo principal, com seções internas e fixtures correspondentes, preservando
classes, geometrias e os mains de documentos standalone. A publicação deste ajuste
adicional exige seus próprios gates e aceite; o receipt anterior não o certifica.
