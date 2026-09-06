# TDA — regras de trabalho
- Repositório canônico novo; dnd-scribe é referência. Não copiar o monólito.
- main = Production; Preview = homologação; outras branches temporárias.
- Sem deployment por push. Não executar deploy para testar mudanças. Fechar o escopo, revisar, validar build/testes/visual e só então publicar deliberadamente a entrega autorizada.
- Últimas versões estáveis verificadas; exceção aprovada: Node 24 por hosting gratuito.
- Nunca commitar .env, segredos, transcrições privadas ou material local.
- Supabase existente é produção. Sem migrations ou escritas durante a fundação.
- Transcrição pesada permanece local. Não arquivar áudios no R2 nem reativar ingestão cloud.
- Antes de alterar Next, ler a documentação pertinente em node_modules/next/dist/docs.
- Consultar docs/README.md e atualizar o estado com evidências, sem confundir código com publicação.
