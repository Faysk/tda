# Infraestrutura e estado
Revisão: 2026-09-06. Responsável: proprietário e implementador.

| Recurso | Estado |
| --- | --- |
| GitHub Faysk/tda | Repositório público criado; main e Preview são as branches permanentes |
| Vercel projeto-desenv-6905 / tda | Criado na equipe projeto-desenv-6905s-projects, Hobby, Node 24; zero deployments; sem integração Git automática |
| R2 tda-media-public | Criado Standard; acesso público desligado |
| R2 tda-media-private | Criado Standard; privado |
| R2 tda-media-preview | Criado Standard; privado, isolado |
| Supabase existente | Leitura validada: 11 sessões publicadas; home e detalhe consultam diretamente o banco; sem mutação |
| Site/domínio | Não publicado; domínio antigo preservado |

Não migramos imagens nem apagamos objetos remanescentes do bucket legado. Nenhuma mudança de DNS, OAuth, schema ou conta paga. Preview sem chave de produção. Credenciais administrativas Cloudflare não devem ir ao app: usar token R2 limitado aos buckets necessários.

## Credenciais e ambientes
Token R2 tda-media-production criado com Object Read & Write restrito a tda-media-public e tda-media-private. Leitura dos dois buckets validada, ambos vazios. Mesmo o bucket de nome public ainda está privado: acesso público só será configurado quando houver conteúdo aprovado. Preview não recebe essa credencial.

Vercel recebeu as configurações de produção; chaves Supabase e R2 são Sensitive e ficam apenas no servidor. Preview está com TDA_READ_PUBLISHED_DATA=false e sem segredos de produção. A ligação local fica em .vercel/project.json, ignorada pelo Git. O token temporário de bootstrap foi revogado e sua cópia local removida; rejeição da API confirmada.

Validação da fundação: tipos, lint, quatro testes unitários, links da documentação, build e quatro testes de navegador desktop/mobile aprovados. Home e detalhe conferidos no navegador com dados publicados reais. Varredura dos arquivos candidatos ao Git e JavaScript público sem as credenciais locais. Estes testes não substituem uma futura homologação na Vercel; não houve deployment.

## Custos
Somente franquias gratuitas e plano Hobby; nenhum upgrade contratado. R2 Standard oferece 10 GB-mês, 1 milhão de operações Classe A e 10 milhões Classe B por mês, com egress gratuito. A franquia é compartilhada na conta; excedentes podem gerar cobrança, portanto R2 não representa gratuidade ilimitada ou bloqueio automático de gastos. Não habilitar Infrequent Access, Images ou Stream pagos sem decisão explícita. Não reter áudios brutos.

Fonte verificada em 2026-09-06: [preços oficiais R2](https://developers.cloudflare.com/r2/pricing/).
