# Entrega de 15/10/2026

> Status: vigente
> Owner: release/Companion
> Última revisão: 2026-10-15

Publicação deliberada autorizada pelo mantenedor.

## Web

O código consolidado está em `f5bf46fd168dd17a6ddad7c3930257d1fdac5ff1`, com CI [38673654029](https://github.com/Faysk/tda/actions/runs/38673654029) e CodeQL [38673653959](https://github.com/Faysk/tda/actions/runs/38673653959) aprovados. O Main Preview [38725991855](https://github.com/Faysk/tda/actions/runs/38725991855) publicou `Pre_1.0.3` sem trocar o domínio canônico. A revisão no navegador confirmou Home, duas campanhas, 19 memórias de Destino Sem Fim e a leitura de Ecos de um Futuro Impossível, com menu móvel e retorno de foco por Escape.

O baseline público observado antes desta entrega é `d3f41c1db820444969484693b72c2a9fde9a2086` (`Prod_1.0.0`). O intervalo até o código validado não contém migrations ou mídia canônica nova. Os receipts deste documento entram por PR; após a integração, o SHA novo precisa de CI, CodeQL e Main Preview próprios antes do Production CD. A publicação final e seu número de release devem ser consultados no receipt do workflow e em `/api/version`, sem inferir deploy de um merge.

O primeiro Production CD posterior aos receipts ([38729121317](https://github.com/Faysk/tda/actions/runs/38729121317)) abortou antes de staging ou alteração de tráfego: o gate confundia o ator humano de um dispatch com a proveniência do deployment. O Preview `7091511646` tinha source/ref/environment corretos, status de sucesso e `performed_via_github_app` GitHub Actions, mas `creator.login` era o mantenedor. A correção verifica o aplicativo confiável e conserva todos os gates de identidade, CI, CodeQL, Preview e aprovação; a nova entrega deve repetir o fluxo completo no SHA corrigido.

## Runtimes Stable

Os candidatos fisicamente aceitos foram promovidos sem rebuild ou substituição de bytes:

- [Whisper 1.1.13](https://github.com/Faysk/tda/releases/tag/companion-whisper-runtime-v1.1.13): [run 38726177711](https://github.com/Faysk/tda/actions/runs/38726177711).
- [Qwen 1.0.21](https://github.com/Faysk/tda/releases/tag/companion-qwen-runtime-v1.0.21): [run 38726181564](https://github.com/Faysk/tda/actions/runs/38726181564).

Os workflows verificaram os assets novamente após a promoção. Os receipts de runtime continuam no [registro físico](runtime-acceptance-2026-10-15.md). As versões anteriores foram preservadas para rollback.

## Companion 0.3.29

O candidato desta entrega é `companion-rc-v0.3.29-f5bf46fd168d`. Seu manifest tem attestation GitHub verificada contra source e signer `f5bf46fd168dd17a6ddad7c3930257d1fdac5ff1`; os quatro assets também tiveram tamanho e SHA-256 verificados separadamente. O MSI tem SHA-256 `358feb62f5560083d61ea137bf332119fc62d5e339753e73400f100fa682b737`.

Sem jobs ou preparação ativos, a UI e o Agent 0.3.28 foram encerrados, State/Data foram copiados para backup local fora do Git e o MSI 0.3.29 foi instalado com exit code zero. O Agent instalado respondeu `ready` na versão 0.3.29. Whisper 1.1.13 e Qwen 1.0.21 foram instalados a partir dos mesmos archives já verificados, preservando os runtimes antigos.

Os quatro perfis passaram em nova inferência CUDA real na RTX 4070 Laptop GPU, com os mesmos modelos locais e fixture sintética de 110,588 segundos. O receipt vincula os resultados ao MSI e payload manifest exatos desta entrega. Isso comprova execução e alinhamento; não comprova qualidade linguística editorial ou assinatura Authenticode.

O [aceite instalado](../companion/acceptance/companion-rc-v0.3.29-f5bf46fd168d.json) terminou com PASS: recuperação do Agent, conflito de porta, diagnóstico WebView2, fechamento para a bandeja, saída da UI sem matar o Agent, Craig selecionado e reutilizado após recovery, retomada BITS medida no mesmo job e quatro perfis prontos. O [aceite físico](../companion/acceptance/companion-rc-v0.3.29-f5bf46fd168d.physical.json) também passou. Ambos excluem áudio, transcrição, token e caminhos locais; fixtures, logs e backup continuam fora do Git. A promoção Stable só pode consumir esses receipts e os mesmos bytes, pelo workflow próprio.

## Branches e recuperação

Antes da limpeza, 152 referências locais/remotas foram registradas fora do Git e preservadas em `refs/tda-archive/20261015/`. Os worktrees históricos foram destacados no mesmo commit, sem alteração de arquivos; todos estavam sem mudanças rastreadas e seus arquivos não rastreados foram mantidos. A limpeza final deve remover apenas branches temporárias, preservar `main` e usar comparação do SHA esperado para impedir exclusão de uma branch alterada concorrentemente. Os diretórios de trabalho e State/Data não fazem parte da limpeza.

Rollback Web: promover deliberadamente o deployment anterior conforme o [runbook](release-runbook.md), sem reset de banco. Rollback Companion: reinstalar o MSI 0.3.28 preservado localmente e restaurar o backup somente se necessário; não purgar State/Data. Recuperação de branch: criar uma branch temporária a partir da respectiva referência arquivada.
