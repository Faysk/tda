# Aceites físicos dos candidatos — 15/10/2026

> Owner: Companion/release. Source e signer: `75423cf7acc51704d79c3857ad60c155c305908c`.

Os quatro perfis executaram inferência real CUDA na NVIDIA GeForce RTX 4070 Laptop GPU (8 GiB, driver 617.42), com fala sintética Microsoft Maria em português de 110,588 segundos. Fixtures, WAV/ZIP, logs brutos e modelos ficaram fora do Git. Instalação isolada não substituiu o Companion instalado ou seus dados.

| Candidato | Resultado físico | Prova canônica |
| --- | --- | --- |
| Whisper 1.1.13 | turbo e detailed passaram; RTF 0,042 e 0,066 | [receipt sanitizado](../companion/runtime-acceptance/companion-whisper-runtime-rc-v1.1.13-75423cf7acc5.json) |
| Qwen 1.0.21 | fast e quality passaram; inferência e Forced Aligner reais; RTF ASR 0,100 e 0,109 | [receipt sanitizado](../companion/runtime-acceptance/companion-qwen-runtime-rc-v1.0.21-75423cf7acc5.json) |
| Companion 0.3.29 | MSI/ZIP/checksum/payload manifest: tamanhos e SHA256 conferidos; ZIP CRC passou. Aceite instalado continua pendente | [RC imutável](https://github.com/Faysk/tda/releases/tag/companion-rc-v0.3.29-75423cf7acc5) |

Consumidor `rc-attestation-consumer.mjs` verificou criptograficamente os manifests das três famílias com `gh attestation verify`, source e signer confrontados com os runs GitHub. Resultado `verified-github-attestation` para Companion, Whisper e Qwen. Isso não verifica automaticamente outros assets nem concede promoção. Os assets foram verificados separadamente: downloads Whisper pelo helper de instalação; Qwen por partes, bundle, archive reconstruído e worker instalado; Companion por cada entrada do candidate manifest. Nenhum asset histórico foi alterado.

Os dois receipts de runtime foram selados por `runtime_release_evidence seal-physical` e aceitos por `verify-promotion`, gerando apenas previews locais. Hash do archive Whisper: `eddeae0e8fda903218c86d8129f74bf2da003386268c2e3da2aaf71dba3accd1`; Qwen: `c5c3dd958450845c75b272b6d2af784e1481407b33e00eca1b0e44045165a9ab`. Os receipts registram modelo/worker/binding e comprovam ausência de áudio, transcrição e paths locais.

Este registro descreve o aceite inicial, anterior à publicação. Na etapa seguinte, autorizada pelo mantenedor, Whisper 1.1.13 e Qwen 1.0.21 foram promovidos a Stable, o Main Preview foi validado e o Companion 0.3.29 foi instalado com backup de State/Data. O candidato final tem source `f5bf46fd168dd17a6ddad7c3930257d1fdac5ff1`, sem mudança dos runtimes. O [registro da entrega](release-delivery-2026-10-15.md) contém as evidências posteriores e os limites da publicação. A qualidade linguística editorial não é provada por fala sintética. Authenticode permanece no escopo de #395; attestation não é assinatura Windows. As versões anteriores e o MSI 0.3.28 foram preservados para rollback.

