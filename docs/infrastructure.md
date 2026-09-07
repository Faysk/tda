# Infraestrutura e estado
Revisão: 2026-09-07. Responsável: proprietário e implementador.

| Recurso | Estado |
| --- | --- |
| GitHub Faysk/tda | Repositório público criado; main e Preview são as branches permanentes |
| Vercel projeto-desenv-6905 / tda | Equipe projeto-desenv-6905s-projects, Hobby, Node 24; production ativa desde 2026-09-07; primeiro deployment READY; sem integração Git automática |
| R2 tda-media-public | Criado Standard; acesso público desligado |
| R2 tda-media-private | Criado Standard; privado |
| R2 tda-media-preview | Criado Standard; privado, isolado |
| Supabase existente | 11 sessões publicadas; três migrations TDA aplicadas para identidade de projeto, domínio narrativo e compatibilidade de entities; sem alteração de canon |
| Site/domínio | Reboot publicado e ativo em `https://dnd.faysk.dev`; aliases Vercel preservados |
| Vercel legado DND/dnd-scribe | Excluído por ordem do proprietário; consulta em 2026-09-07 retorna project_not_found. Novo tda preservado |

Não migramos imagens nem apagamos objetos remanescentes do bucket legado. Nenhuma conta paga nova foi contratada. Preview sem chave de produção. Credenciais administrativas Cloudflare não devem ir ao app: usar token R2 limitado aos buckets necessários.

## Supabase
O projeto existente `dmrqnbdvbkfqzctcerbx` continua sendo a única base. Em 2026-09-06 o reboot passou a versionar mudanças novas em `supabase/migrations` e aplicou:

- `20260906210333_align_tda_domain_identity`: adiciona `tda` como scope técnico canônico sem remover `dnd-scribe`, cria o vínculo de PCs com `entities` e prepara participantes para a identidade narrativa canônica;
- `20260906210427_backfill_narrative_entity_links`: liga as 12 participações históricas dos três PCs às suas entities e cria índices do domínio narrativo;
- `20260906211040_relax_reboot_entity_name_lookup`: mantém a constraint `(campaign_id, name)` exigida pelo consolidator legado, remove apenas a unicidade case-insensitive adicional e deixa índice de busca por `lower(name)`.

`yuhara-main` permanece como slug da campanha. `craig`, `local_companion` e demais valores de proveniência permanecem inalterados. Nenhuma `canon_entry` ou `entity_mention` foi criada automaticamente.

O banco segue com RLS deny-by-default em grande parte das tabelas. SECURITY DEFINER e grants legados serão auditados antes de abrir o Edit; não houve revogação em massa que pudesse quebrar o aplicativo antigo.

## Credenciais e ambientes
Token R2 tda-media-production criado com Object Read & Write restrito a tda-media-public e tda-media-private. Leitura dos dois buckets validada, ambos vazios. Mesmo o bucket de nome public ainda está privado: acesso público só será configurado quando houver conteúdo aprovado. Preview não recebe essa credencial.

Vercel recebeu as configurações de produção documentadas. Em 2026-09-07 a integração ChatGPT/Vercel MCP foi reautorizada na conta correta `projeto-desenv-6905 / projeto_desenv@outlook.com`; acesso à equipe `projeto-desenv-6905s-projects` (`team_9wuTfarCQ3L63xtufPKUDzi0`) e ao projeto `tda` (`prj_hDiDvvRiesg3qCDekGWE8JQMkIyH`) foi confirmado antes da primeira mutação. Toda ação futura deve continuar confirmando esse contexto antes de alterar projeto, ambiente ou deployment.

A ligação local fica em `.vercel/project.json`, ignorada pelo Git. O token temporário de bootstrap antigo foi revogado e sua cópia local removida; rejeição da API confirmada.

Validação da fundação e front atual: tipos, lint, testes unitários, links da documentação, build e testes de navegador desktop/mobile aprovados nas PRs anteriores. Home e detalhe foram conferidos com dados publicados reais.

Em 2026-09-07 foi publicado o primeiro deployment controlado do reboot em production, usando como origem o SHA `a7e9053ff2d3f42b6b110558bb51a8e2105125ec`. O deployment `dpl_CHFi2UCFGZjE5shTj7UvsghHtRPe` terminou `READY`; a Home e `/api/health` responderam HTTP 200, a Home exibiu as 11 memórias publicadas e não foram encontrados runtime errors no intervalo verificado após a publicação.

Depois do deployment inicial, o domínio oficial `dnd.faysk.dev` foi associado ao projeto `tda` e promovido para o mesmo Production #001, sem novo build. Em `2026-09-07T04:04Z`, `https://dnd.faysk.dev/` e `https://dnd.faysk.dev/api/health` responderam HTTP 200; o health confirmou `application=tda` e `environment=production`, com HTTPS ativo e resposta servida pela Vercel. O valor exato do registro Cloudflare não foi inferido na documentação porque a consulta DNS auxiliar falhou durante a verificação. Evidências completas em `docs/operations/deployments.md`.

## Custos
Somente franquias gratuitas e plano Hobby; nenhum upgrade contratado. R2 Standard oferece 10 GB-mês, 1 milhão de operações Classe A e 10 milhões Classe B por mês, com egress gratuito. A franquia é compartilhada na conta; excedentes podem gerar cobrança, portanto R2 não representa gratuidade ilimitada ou bloqueio automático de gastos. Não habilitar Infrequent Access, Images ou Stream pagos sem decisão explícita. Não reter áudios brutos.

Fonte verificada em 2026-09-06: [preços oficiais R2](https://developers.cloudflare.com/r2/pricing/).
