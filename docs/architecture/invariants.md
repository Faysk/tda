# Princípios e invariantes

> Status: vigente
> Owner: arquitetura
> Última revisão: 2026-09-06

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

## Futuro

45. Relations terão edge próprio com semântica, evidence e visibility; não serão escondidas em metadata.
46. Knowledge/audience precisa distinguir jogador, personagem, público, rumor, mentira e segredo do mestre.
47. Embedding/busca semântica nunca altera autoridade canônica do conteúdo indexado.
48. Visualização (React Flow/mapa) não dita o modelo de dados.
