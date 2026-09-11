# TDA Companion — política de dependências

Status: requisito de release
Owner: local-companion / processing
Última revisão: 2026-09-11

O Companion deve usar a versão estável mais recente que seja compatível com a arquitetura suportada. Todos os pins permanecem exatos e reproduzíveis.

Antes de promover uma release:
- auditar dependências diretas, runtime, build e empacotamento contra os upstreams atuais;
- auditar revisions dos modelos ASR e do alinhador;
- rodar testes Windows/Linux, bundle, MSI e smoke do runtime;
- para mudanças GPU/ASR, validar fisicamente na RTX 4070 8 GB;
- não alterar Python, CUDA ou PATH global do computador do usuário.

CUDA segue a família suportada pelo Faster-Whisper/CTranslate2. Uma major numericamente mais nova não substitui automaticamente a baseline compatível. Exceções precisam ser explicitamente documentadas antes do release.

Fontes de verdade: `pyproject.toml`, `requirements-test.lock`, `runtime/whisper-windows-x64.json`, `tda_companion/asr_models.py` e os workflows do Companion.
