# Princípios e invariantes

> Status: vigente
> Owner: arquitetura
> Última revisão: 2026-09-10

Invariantes são regras que não devem ser quebradas silenciosamente por uma feature local. Se uma futura necessidade exigir violar uma delas, registrar ADR antes da mudança.

## Produto e repositório

1. `Faysk/tda` é a fonte de verdade do reboot.
2. `Faysk/dnd-scribe` é legado/referência histórica.
3. O TDA possui um único frontend público canônico.
4. `main` representa o código aprovado, mas não é gatilho automático de deploy.
5. Produção não é ambiente descartável nem resetável por conveniência.

## Identidade

6. `tda` é identidade de produto; `yuhara-main` é identidade da campanha.
7. Provenance (`craig`, `discord`, `roll20`, `local_companion`) não é renomeada para refletir branding.
8. `profiles` representa pessoas/contas.
9. `entities` representa objetos narrativos.
10. PC e NPC não possuem registries concorrentes.
11. `participants` é ocorrência em sessão, não identidade global.

## Evidência e canon

12. Transcrição não é canon.
13. Evento externo não é canon.
14. Classificação de IA não é canon.
15. Candidato não aprovado não é canon.
16. Canon exige fonte e revisão.
17. Interpretação deve permanecer identificável como interpretação.
18. Retcon/supersession preserva histórico; não reescreve silenciosamente a evidência.

## Segurança

19. Secrets administrativos nunca chegam ao browser.
20. Service/secret keys ficam server-side ou em workers autorizados.
21. RLS sem policy pode ser deny-by-default deliberado; não abrir leitura apenas para eliminar lint.
22. `SECURITY DEFINER` exposto precisa autorização interna e grants deliberados.
23. Nova UI decide acesso por capability/scope, não por nome de role hardcoded.
24. Preview não recebe automaticamente credenciais/dados irrestritos de produção.
25. Conteúdo de mestre/segredo deve ter audience explícita antes de ser exposto.

## Banco

26. Nova DDL entra por migration versionada.
27. Migration aplicada remotamente deve existir no repo com mesma versão/nome.
28. Backfill não inventa fato ausente; inferência deve ser explícita e justificada.
29. UUID é identidade técnica preferida; nome é apresentação/resolução.
30. JSONB serve extensão/metadados, não substitui relação estruturada central.
31. Remoção de schema/grant/compatibilidade só ocorre após provar independência do consumidor antigo.

## Processamento

32. Processamento pesado de áudio/transcrição continua local até nova decisão arquitetural.
33. Conteúdo já sincronizado deve continuar disponível com companion desligado.
34. Jobs longos devem ser retomáveis; retries não devem duplicar efeitos.
35. Raw/intermediários possuem política de retenção explícita.
36. Áudio bruto não é requisito de retenção cloud do reboot.
37. Hashes/source IDs devem permitir deduplicação e auditoria quando disponíveis.

## Mídia

38. R2 guarda binários; PostgreSQL guarda identidades/relações/metadados do domínio.
39. Bucket chamado `public` não implica autorização automática de conteúdo.
40. URL assinada é mecanismo de entrega, não decisão de permissão.

## Operação

41. Deploy é ação controlada após validação, não mecanismo de desenvolvimento.
42. A Vercel correta precisa ser verificada antes de qualquer operação: `projeto-desenv-6905` / `projeto_desenv@outlook.com`.
43. Rollback deve ser definido antes de promover candidato importante.
44. Mudança estrutural sem documentação correspondente não está completa.

## Memória e exploração

45. Relations terão edge próprio com semântica, evidence e visibility; não serão escondidas em metadata.
46. Knowledge/audience precisa distinguir jogador, personagem, público, rumor, mentira e segredo do mestre.
47. Embedding/busca semântica nunca altera autoridade canônica do conteúdo indexado.
48. Visualização não dita o modelo de dados.
49. A própria existência de uma relation pode ser secreta; autorização ocorre antes da projection entregue ao browser.
50. Mention/coocorrência não cria relation canônica automaticamente.
51. Fixture visual ou screenshot de referência não é fonte de canon.
52. World Explorer mostra vizinhança controlada por padrão; não carrega o grafo completo sem necessidade explícita.
53. O grafo nunca é a única forma de consumir relations; existe representação textual/navegável alternativa.

## Design System e marca

54. `TDA Design System v1.0.0` é a direção visual oficial enquanto não for superseded por versão/ADR documentada.
55. O Brand Pack oficial é autoridade da geometria de logo/pato/lockups; componentes não redesenham a marca.
56. Componentes usam papel semântico/token antes de hexadecimal local quando o token existe.
57. Light e dark preservam a mesma hierarquia, não dois produtos diferentes.
58. Visitante vê história; editor vê estado editorial.
59. Dourado é acento raro, não decoração indiscriminada.
60. Mobile reorganiza a composição; não é desktop apenas comprimido.
61. Uma tela visual não está pronta sem teclado, foco, contraste e `prefers-reduced-motion`.

## React Flow

62. React Flow (`@xyflow/react`) é engine de apresentação do World Explorer, não contrato de domínio.
63. `nodes[]`/`edges[]`, posições, handles e tipos visuais são DTO/estado de UI, não rows de `entities`/relations por definição.
64. O modo público do World Explorer não expõe criação/delete de edges/nodes.
65. A primeira estratégia de layout é radial e própria; nova engine de layout exige necessidade observada e documentação.
66. A adoção de React Flow não obriga páginas editoriais ou o restante do domínio a se tornarem Client Components.

## Feedback de carregamento

67. Espera bloqueante iniciada pelo usuário deve ter feedback visual global consistente; o loader oficial do TDA é o contrato padrão dessa espera.
68. Navegação interna usa `PublicLink`/primitives que delegam a ele, para que o estado pendente do App Router participe do loader sem sacrificar prefetch.
69. Operações de feature expõem espera bloqueante por `aria-busy="true"`, `data-global-loading="true"`, `useGlobalLoadingFlag()` ou `useGlobalLoading()`; o chamador que inicia a espera também é responsável por encerrá-la.
70. Polling, heartbeat, prefetch, autosave silencioso e sincronização de fundo não acionam overlay global; quando necessário, um subtree pode declarar `data-global-loading="off"`.
71. O loader não intercepta `fetch` globalmente e não deve alterar semântica HTTP. Em especial, preservar status reais como `404` vale mais do que obter um boundary de streaming genérico no layout raiz.
72. Esperas instantâneas não devem piscar overlay: a infraestrutura aplica uma pequena janela antes de exibir o loader, exceto quando um fallback de rota precisa existir antes da hidratação.
73. O loader preserva a geometria oficial da marca; halos, partículas, órbitas e motion são camadas de apresentação separadas e respeitam `prefers-reduced-motion`.
74. O loader segue o tema ativo do TDA: dark preserva a versão aprovada; light deriva sua paleta dos tokens semânticos do Design System. Não existe tema paralelo específico do loader.
75. Trocar light/dark altera apenas a paleta de apresentação do loader; timing, hierarquia, significado, tamanho e sequência de movimento permanecem equivalentes entre os temas.
