# Publicação controlada
main e Preview são branches permanentes, não gatilhos de deploy. Vercel git.deploymentEnabled=false; CI não contém deploy. A conta Vercel alvo é projeto-desenv-6905, não DND/dndscribe.

Antes de publicar: escopo fechado, revisão, instalação limpa, tipos/lint/testes, build de produção, teste visual desktop/mobile, revisão de dados/permissões, SHA conhecido e rollback. Cloud só recebe candidato validado. Não usar publicações repetidas como desenvolvimento; não reativar auto-deploy após liberar cotas. CLI/prebuilt também consome cota.

Não há deploy nesta entrega de estrutura. O domínio dnd.faysk.dev continua na operação antiga. Configurar projeto e variáveis não significa publicar. No futuro, homologar com ambiente de dados isolado/autorizado; conferir runtime/health, promover e testar o domínio.
