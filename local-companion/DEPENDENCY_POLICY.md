# TDA Companion — política de dependências

Status: requisito de release
Owner: local-companion / processing
Última revisão: 2026-10-01

O Companion deve usar a versão estável mais recente que seja compatível com a arquitetura suportada. Todos os pins permanecem exatos e reproduzíveis.

Antes de promover uma release:
- auditar dependências diretas, runtime, build e empacotamento contra os upstreams atuais;
- auditar revisions dos modelos ASR e do alinhador;
- rodar testes Windows/Linux, bundle, MSI e smoke do runtime;
- para mudanças GPU/ASR, validar fisicamente na RTX 4070 8 GB;
- não alterar Python, CUDA ou PATH global do computador do usuário.

CUDA segue a família suportada pelo Faster-Whisper/CTranslate2. Uma major numericamente mais nova não substitui automaticamente a baseline compatível. Exceções precisam ser explicitamente documentadas antes do release.

## Exceção de decoder Whisper — #1234

O Whisper Runtime 1.1.6 fixa **PyAV 18.1.0** enquanto permanece em Faster-Whisper 1.2.1. Essa combinação é deliberada: Faster-Whisper 1.2.1 ainda chama `av.open(..., metadata_errors="ignore")`, argumento removido pelo PyAV 19. A exceção é específica do runtime Whisper; o runtime Qwen continua isolado e pode usar PyAV 19.

O build Whisper precisa executar, dentro do executável empacotado, decode CPU real de fixtures PCM WAV e FLAC através de `faster_whisper.audio.decode_audio`. Import/probe isolado não satisfaz este gate. A exceção só pode ser removida depois que uma versão compatível do Faster-Whisper passar esse smoke empacotado e o aceite físico dos dois perfis Whisper no artefato exato.

Fontes de verdade: `pyproject.toml`, `requirements-test.lock`, `runtime/whisper-windows-x64.json`, `tda_companion/asr_models.py` e os workflows do Companion.
