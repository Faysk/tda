# Pré-flight R2 e assets das novas lores

> Status: preparado; execução central pendente
> Owner: integrations/media
> Última revisão: 2026-09-07
> Fonte de verdade: SELECT atual, otimizador publicado, pacotes locais e responsáveis pelos consumidores

## Referências de sessões

O [pré-flight somente leitura](evidence/r2-promotion-preflight-2026-09-07.json) confirmou que o otimizador publicado aceita uma origem WebP e uma PNG no R2: ambos GET 200 e imagem decodificável. A comparação de todas as 11 sessões/22 referências atuais coincidiu com os valores antigos esperados por `tools/media/operations/promote-r2-images-after-release.sql`. O SQL de rollback compara as URLs R2 promovidas e restaura as URLs funcionais pós-reparo, não os 404 históricos.

Nenhum SQL de promoção/rollback foi executado; nenhum upload de sessão foi repetido. Este resultado é um pré-flight observado, não uma reserva de estado. Na execução central, repetir o SELECT imediatamente antes; qualquer divergência exige revisão, nunca reescrever silenciosamente o CAS. Tanto promoção quanto rollback abortam a transação inteira em conflito. O [plano operacional existente](media-public-delivery-2026-09-07.md#promoção-r2-após-release-compatível) continua sendo o procedimento dono.

## Inventário confirmado com os consumidores

- **Pipipi:** identidade editorial estática `pipipi`, rota `/lore/pipipi`, sem entity UUID/projeção Supabase. Sete WebPs públicos autorizados: `pipipi` (hero/preview), `casa`, `corredores`, `super_herois`, `cadeira`, `ultimo_dia`, `acordou`. Total 1.564.176 bytes. `ultimo_dia` não era referenciado pelo HTML original, mas foi explicitamente incluído pelo responsável pelo novo consumidor. Spoilers editoriais não mudam ACL. O consumidor mantém cópia local própria até promoção deliberada.
- **Claquete:** demo técnica `parallax-art-demo-v1`, sem personagem/entity/lore canônica. Oito camadas SVG de 1920×1080: 00-sky, 01-mountains, 02-castle, 03-fog-back, 04-crowd, 05-hero, 06-foreground e 07-fog-front. Total 10.208 bytes. `noise.svg`, HTML, CSS, JS, launchers e narração não entram no plano de upload. `assetBaseUrl` pode apontar para o prefixo do conjunto após publicação; a fixture local continua independente.

O [manifesto preparado](evidence/lore-assets-prepared-2026-09-07.json) contém SHA-256 dos ZIPs, lista de exclusões, caminho de origem, SHA-256 de cada original, MIME pelos bytes, dimensões, identidade, papel, bucket/key e URL planejada. Todos mantêm `publicUrl=null`, `publicDeliveryStatus=not-verified` e `uploadStatus=not-uploaded`. A URL planejada não é evidência pública nem permissão para o metadata builder.

Os 15 assets foram decodificados sem recompressão. SVG foi analisado como XML e limitado a elementos estáticos revisados, sem DTD, entidades, scripts, eventos, foreignObject ou referências externas. A função de upload não aceita arquivos adicionais, namespace privado/preview, path traversal, identidade canônica inventada ou hash divergente.

## Preparação reproduzível

Na raiz do clone, com Node 24, dependências do lockfile e Python 3 (somente biblioteca padrão):

```powershell
python tools/media/prepare-lore-assets.py
node tools/media/measure-lore-assets.mjs
node tools/media/stage-lore-assets.mjs
node --env-file=D:/Projects/tda/.env.local tools/media/stage-lore-assets.mjs --check-r2
python -m unittest discover -s tools/media -p test_lore_svg.py
node --test tools/media/lore-assets.test.mjs
```

O preparador lê somente os dois ZIPs nomeados em Downloads e extrai apenas a lista explícita de imagens para `.local/lore-assets`, preservando bytes existentes e abortando colisão local. O medidor usa o Sharp já existente e regenera o snapshot: qualquer diferença deve ser revisada antes de upload. O [dry-run remoto](evidence/lore-assets-dry-run-2026-09-07.json) fez somente HEAD das 15 keys planejadas: todas ausentes, zero escrita.

## Execução central futura, não realizada nesta tarefa

Upload exige escolher **um** pacote explicitamente:

```powershell
node --env-file=D:/Projects/tda/.env.local tools/media/stage-lore-assets.mjs --package pipipi-lore-premium --upload
node --env-file=D:/Projects/tda/.env.local tools/media/stage-lore-assets.mjs --package parallax_art_demo --upload
```

O script valida todos os bytes locais antes da primeira operação remota e reutiliza o transporte idempotente já testado: HEAD, colisão aborta, PUT com `IfNoneMatch: *`, GET/read-back/hash obrigatório, skip apenas após igualdade comprovada. O bucket é fixo `tda-media-public`. Checkpoints de resultado ficam em `.local/lore-stage-{package}.json`. Falhas são explícitas; não há atualização de DB, configuração de domínio ou promoção de URL pública nesse script.

Após upload central, GET HTTPS anônimo de **cada** objeto deve confirmar MIME, tamanho, hash e decodificação. Só então emitir registro separado `verified-public`, adaptar o consumidor e validar HTML/browser. `assetBaseUrl` de demo e paths de lore ainda precisam ser aceitos explicitamente no consumidor; a allowlist de sessões não libera novos namespaces. Para SVG externo, validar a política de carregamento/CSP do consumidor sem abrir a otimização SVG global do Next.

Rollback de preparação é não promover referências; após upload aditivo, manter os objetos e restaurar a referência/configuração anterior do consumidor com comparação de estado. Não apagar originais nem objetos, não tocar private/preview e não armazenar áudios. A execução final pertence à coordenação para evitar conflito com as tarefas de conteúdo.
