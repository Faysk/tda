# Roadmap
1. Fundação: repositório, CI sem deploy, identidade base, leitura Supabase, buckets e configuração Vercel.
2. Home/sessões/resumos completos: conteúdo reconciliado, imagens migradas verificadas, temas, mobile, acessibilidade, URLs antigas e autenticação. Só publicar após aceite do recorte.
3. Edit integrado: login e autorização únicos, revisão/publicação e catálogo de mídias. Convergir a autorização para capabilities do RBAC sem quebrar o legado durante a transição.
4. Operação local: modernizar transcrição com comparação de qualidade/tempo/memória; integração autenticada, retomável e sem duplicação.
5. Memória estruturada: popular `entities`/`entity_mentions`/`canon_entries` a partir de conteúdo revisado. PCs e NPCs usam a mesma registry canônica; profile e participant permanecem identidades humanas/operacionais.
6. Relações e conhecimento: modelar edges entre entidades, audiência/segredos/rumores e "quem sabe o quê"; avaliar React Flow somente depois de fechar a semântica e as regras de visibilidade.
7. Exploração: busca semântica com fontes, timeline por entidade, mapas, músicas/performances, quests/ganchos e demais superfícies derivadas da memória estruturada.

Lore pipipi depende da fonte: transcrição/evento não vira canon automaticamente. O reboot não exige migrar ou apagar dados para começar. O legado continua operando durante a transição e só será arquivado após independência comprovada.

O contrato dos conceitos está em [data-model.md](data-model.md). Features históricas do `dnd-scribe` só entram neste roadmap depois de revalidadas e incorporadas ali.
