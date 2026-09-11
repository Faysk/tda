# Companion — política de versões e dependências

> Status: requisito de release
> Owner: local-companion / processing
> Última revisão: 2026-09-11

## Regra

O TDA Companion deve usar a versão **estável mais recente e compatível** das dependências que fazem parte do runtime, build, empacotamento e ASR.

"Mais recente" não significa atualizar cegamente um major incompatível. Uma versão só pode virar baseline quando:

- é release estável, não preview/RC/dev;
- oferece artefato suportado para Windows x64 quando necessário;
- é compatível com a família de Python/runtime escolhida;
- passa testes Windows e Linux aplicáveis;
- passa build do bundle e MSI;
- passa smoke do runtime isolado;
- para GPU/ASR, passa teste físico na RTX 4070 8 GB antes de ser declarada suportada;
- não exige alterar Python, CUDA ou PATH global do computador do usuário.

Os pins continuam exatos para tornar cada release reproduzível. Antes de publicar uma nova release, os pins devem ser auditados contra os upstreams atuais.

## Automação

- Dependabot monitora diariamente Python/pip do `local-companion` e GitHub Actions.
- O workflow de freshness verifica os pins Python/PyPI e o runtime Whisper contra os releases estáveis disponíveis.
- Mudança detectada não é auto-publicada: primeiro atualizamos o pin e executamos os gates novamente.

## CUDA

Para Faster-Whisper/CTranslate2, o TDA segue a família CUDA suportada pelo upstream. Enquanto CTranslate2 exigir CUDA 12.x para os wheels usados pelo Companion, **CUDA 13 não substitui a baseline só por ser numericamente mais nova**.

Dentro da família CUDA 12.x, usamos os releases estáveis mais recentes de runtime/cuBLAS/cuDNN que passem o build, o probe e o teste físico.

O manifest do runtime registra separadamente:

- driver mínimo pela compatibilidade minor da família CUDA;
- driver recomendado correspondente ao toolkit/runtime usado no build.

## Exceções

Toda exceção precisa ser explícita e ter justificativa técnica ou legal.

### WiX Toolset

O MSI permanece temporariamente em WiX 5.0.2. WiX 6/7 introduzem mudança major e requisitos de licenciamento/OSMF que precisam ser avaliados antes de adotarmos a versão mais nova no pipeline. Essa retenção não autoriza deixar as demais dependências desatualizadas.

A migração de WiX deve ser testada isoladamente e só entra quando o contrato/licenciamento e os smokes de install/upgrade/uninstall/purge estiverem aprovados.

## Fontes de verdade

- Dependências Python do Companion: `local-companion/pyproject.toml`
- Lock dos testes: `local-companion/requirements-test.lock`
- Runtime Whisper Windows: `local-companion/runtime/whisper-windows-x64.json`
- Workflow do Companion: `.github/workflows/companion.yml`
- Workflow do runtime Whisper: `.github/workflows/whisper-runtime.yml`

Uma release não deve ser promovida para produção se a auditoria de versões estiver pendente ou se uma exceção necessária não estiver documentada.
