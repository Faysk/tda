# Infraestrutura e estado
Revisão: 2026-09-06. Responsável: proprietário e implementador.

| Recurso | Estado |
| --- | --- |
| GitHub Faysk/tda | Repositório público criado; main e Preview são as branches permanentes |
| Vercel projeto-desenv-6905 / tda | Criado na equipe projeto-desenv-6905s-projects, Hobby, Node 24; zero deployments; sem integração Git automática |
| R2 tda-media-public | Criado Standard; acesso público desligado |
| R2 tda-media-private | Criado Standard; privado |
| R2 tda-media-preview | Criado Standard; privado, isolado |
| Supabase existente | 11 sessões publicadas; duas migrations TDA aplicadas para identidade de projeto e domínio narrativo; sem alteração de conteúdo/canon |
| Site/domínio | Não publicado; domínio antigo preservado |

Não migramos imagens nem apagamos objetos remanescentes do bucket legado. Nenhuma mudança de DNS ou conta paga. Preview sem chave de produção. Credenciais administrativas Cloudflare não devem ir ao app: usar token R2 limitado aos buckets necessários.

## Supabase
O projeto existente `dmrqnbdvbkfqzctcerbx` continua sendo a única base. Em 2026-09-06 o reboot passou a versionar mudanças novas em `supabase/migrations` e aplicou:

- `20260906210333_align_tda_domain_identity`: adiciona `tda` como scope técnico canônico sem remover `dnd-scribe`, cria o vínculo de PCs com `entities` e prepara participantes para a identidade narrativa canônica;
- `20260906210427_backfill_narrative_entity_links`: liga as 12 participações históricas dos três PCs às suas entities e cria índices do domínio narrativo.

`yuhara-main` permanece como slug da campanha. `craig`, `local_companion` e demais valores de proveniência permanecem inalterados. Nenhuma `canon_entry` ou `entity_mention` foi criada automaticamente.

O banco segue com RLS deny-by-default em grande parte das tabelas. SECURITY DEFINER e grants legados serão auditados antes de abrir o Edit; não houve revogação em massa que pudesse quebrar o aplicativo antigo.

## Credenciais e ambientes
Token R2 tda-media-production criado com Object Read & Write restrito a tda-media-public e tda-media-private. Leitura dos dois buckets validada, ambos vazios. Mesmo o bucket de nome public ainda está privado: acesso público só será configurado quando houver conteúdo aprovado. Preview não recebe essa credencial.

Vercel recebeu as configurações de produção documentadas; qualquer ação futura deve confirmar o contexto `projeto-desenv-6905 / projeto_desenv@outlook.com` antes de alterar projeto, ambiente ou deployment. A integração Vercel disponível nesta conversa não corresponde a essa conta e não deve ser usada.

A ligação local fica em `.vercel/project.json`, ignorada pelo Git. O token temporário de bootstrap foi revogado e sua cópia local removida; rejeição da API confirmada.

Validação da fundação e front atual: tipos, lint, testes unitários, links da documentação, build e testes de navegador desktop/mobile aprovados nas PRs anteriores. Home e detalhe foram conferidos com dados publicados reais. Não houve deployment do reboot.

## Custos
Somente franquias gratuitas e plano Hobby; nenhum upgrade contratado. R2 Standard oferece 10 GB-mês, 1 milhão de operações Classe A e 10 milhões Classe B por mês, com egress gratuito. A franquia é compartilhada na conta; excedentes podem gerar cobrança, portanto R2 não representa gratuidade ilimitada ou bloqueio automático de gastos. Não habilitar Infrequent Access, Images ou Stream pagos sem decisão explícita. Não reter áudios brutos.

Fonte verificada em 2026-09-06: [preços oficiais R2](https://developers.cloudflare.com/r2/pricing/).
