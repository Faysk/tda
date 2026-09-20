# TDA — regras de trabalho
- Repositório canônico novo; dnd-scribe é referência. Não copiar o monólito.
- `main` é a linha canônica de Production; Preview é deployment de homologação por PR, não branch longa; outras branches são temporárias.
- Sem deployment por push. Não executar deploy para testar mudanças. Fechar o escopo, revisar, validar build/testes/visual e só então publicar deliberadamente a entrega autorizada.
- Últimas versões estáveis verificadas; exceção aprovada: Node 24 por hosting gratuito.
- Nunca commitar `.env`, segredos, transcrições privadas ou material local. GitHub é o control plane; secrets operacionais usados pela automação ficam preferencialmente em GitHub Environments e nunca são recuperados de outro provider como cofre indireto.
- PostgreSQL é o contrato relacional principal; Supabase é o provider atual de Production. Toda DDL/grant/policy/function nova entra por migration versionada, com compatibilidade, validação pós-migration e documentação; não resetar dados por conveniência nem espalhar dependência específica do provider sem necessidade.
- Antes de mudança de banco, consultar `docs/operations/database-runbook.md`, `docs/database/security.md` e o contrato de domínio afetado. Mudanças destrutivas ou de autorização exigem consumidor/rollback mapeados.
- Transcrição pesada permanece local. Não arquivar áudios no R2 nem reativar ingestão cloud.
- Antes de alterar Next, ler a documentação pertinente em node_modules/next/dist/docs.
- Consultar docs/README.md e atualizar o estado com evidências, sem confundir código com publicação.
- Toda mídia persistida/publicada pertence ao Media Storage, nunca ao Git como storage canônico; Cloudflare R2 é o provider atual. Antes de preparar, enviar ou consumir mídia, ler `docs/integrations/r2/media-pipeline.md`, `docs/operations/r2-media-runbook.md` e ADR-0018. Só promover referência após read-back, entrega e consumo validados; preservar master, proporção e qualidade perceptível.
- Ao receber ZIP de página/lore, seguir docs/operations/zip-to-production.md e registrar a entrega com docs/templates/lore-pack-delivery.md. Inventariar todas as referências, preservar a composição aprovada e conferir consumidores em produção.

- Arquitetura é free-first e provider-independent: Vercel, Supabase e Cloudflare R2 são providers atuais e substituíveis; não adicionar serviço/tier pago sem necessidade comprovada e decisão documentada.
- Mudança estrutural de provider, secret, workflow, schema, storage, lifecycle, release ou rollback exige atualização do documento dono na mesma PR.
