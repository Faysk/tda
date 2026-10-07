# Companion — política de versões e dependências

> Status: requisito de release
> Owner: local-companion / processing
> Última revisão: 2026-10-06

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

Dependências transitivas do lock não são comparadas cegamente com o maior número publicado no PyPI: a versão correta é a resolvida pela versão atual das dependências diretas. O gate de freshness exige que os **pins diretos/runtime** estejam atuais e que o lock continue compatível com esses pins.

## Modelos ASR

Modelos também fazem parte deste requisito.

- cada modelo/aligner usado pelo Companion tem `revision` imutável de 40 caracteres;
- nunca usamos `main` flutuante em job de produção;
- o gate diário compara a revision pinada com a revision atual do upstream Hugging Face;
- se o upstream mudar, a release fica pendente de auditoria mesmo quando a mudança for apenas README/metadata;
- depois de revisar a mudança, atualizamos o pin e repetimos os gates aplicáveis;
- o conteúdo instalado continua recebendo hash próprio no marker local.

Isso permite simultaneamente saber qual upstream estamos acompanhando e reproduzir exatamente uma execução passada.

## Automação

- Dependabot monitora diariamente Python/pip do `local-companion` e GitHub Actions.
- O workflow de freshness verifica pins diretos Python/PyPI, Python 3.12, runtimes Whisper/Qwen e revisions dos modelos/aligner contra os upstreams atuais.
- Os workflows do Companion, Whisper e Qwen precisam usar o mesmo pin de `uv`.
- Mudança detectada não é auto-publicada: primeiro atualizamos o pin e executamos os gates novamente.

## CUDA

Whisper e Qwen têm runtimes isolados e podem usar famílias CUDA diferentes quando seus upstreams exigirem isso.

### Whisper / CTranslate2

Para Faster-Whisper/CTranslate2, o TDA segue a família CUDA suportada pelo upstream. Enquanto CTranslate2 exigir CUDA 12.x para os wheels usados pelo Companion, **CUDA 13 não substitui a baseline Whisper só por ser numericamente mais nova**.

Dentro da família CUDA 12.x, usamos os releases estáveis mais recentes de runtime/cuBLAS/cuDNN que passem o build, o probe e o teste físico.

### Qwen / PyTorch

Qwen3 usa runtime PyTorch/Transformers separado. O runtime 1.0.5 adota temporariamente o wheel oficial **PyTorch 2.13.0 + CUDA 12.6** como exceção explícita de compatibilidade. O motivo é operacional: CUDA 13.x exige driver NVIDIA da família 580 ou superior para minor-version compatibility, enquanto o Companion não instala nem altera driver NVIDIA automaticamente.

A exceção fica declarada no próprio manifest Qwen em `dependency_freshness_exceptions` e só é aceita pelo gate quando nome e versão coincidem exatamente com o pin efetivo. Trocar o pin invalida a exceção. O caminho de remoção da exceção é repetir o aceite físico numa baseline de driver compatível com CUDA 13.x e então voltar ao PyTorch estável mais recente.

Além da descoberta da GPU, o runtime Qwen deve executar uma operação CUDA real de smoke antes de qualquer modelo ser aceito. `torch.cuda.is_available()` isoladamente não constitui prova suficiente de compatibilidade driver/runtime.

O fato de Qwen poder usar CUDA 13.x não autoriza migrar o runtime Whisper para CUDA 13 enquanto CTranslate2 não suportar essa família.

### PyAV no runtime Whisper — #1234

O **Whisper Runtime 1.1.6** estabeleceu o pin `av==18.1.0` embora PyAV 19 seja mais novo. O Runtime 1.1.7 de #1233 preservou esse decoder ao introduzir o contrato de benchmark. As identidades posteriores permanecem imutáveis; o candidato corrente de #1413 é **Whisper Runtime 1.1.10**, mantendo o mesmo pin de decoder sem reconstruir versões anteriores. Faster-Whisper 1.2.1 ainda abre mídia com `av.open(..., metadata_errors="ignore")`; PyAV 19 removeu esse argumento e por isso a combinação falha antes da inferência real. A exceção fica machine-readable em `runtime/whisper-windows-x64.json`, vinculada ao pin exato.

Whisper e Qwen permanecem runtimes isolados: esta retenção **não** reduz o PyAV do Qwen, que pode continuar em 19.x conforme seu próprio manifest. O gate de freshness audita pins de cada família separadamente para não converter isolamento de runtime em falso conflito global.

Além do probe/import, o build Whisper deve executar no **executável empacotado** um smoke CPU de decode com PCM WAV e FLAC gerados localmente, usando o decoder real `faster_whisper.audio.decode_audio`. O gate valida formato, sample rate e contagem de samples; não carrega modelo e não exige GPU.

A exceção só pode ser removida quando uma versão posterior do Faster-Whisper (ou contrato de decoder equivalente aprovado) aceitar PyAV atual e passar: smoke WAV/FLAC empacotado, suíte do runtime e aceite físico do artefato exato nos perfis `whisper-turbo` e `whisper-detailed`.


## Contrato de benchmark dos runtimes — #1233 / #1413

A prontidão do Whisper possui dois níveis explícitos:

- **compatibilidade do artefato/rollback:** mantém mínimo Whisper `1.1.4`, para que releases históricas permaneçam verificáveis e selecionáveis por manutenção explícita quando aplicável; **dispatch de transcrição Craig atual:** exige Whisper **`>=1.1.10`**. O payload corrente pode incluir `track_policy_version` e `checkpoints`; o worker Stable 1.1.5 não conhece esses campos e pode encerrar com EX_USAGE antes de `READY`. O artefato 1.1.5 permanece imutável como evidência histórica, mas não é elegível para o protocolo atual;
- **benchmark de execução/métricas de #1233:** o piso histórico do Whisper é **`>=1.1.7`**. O `1.1.6` foi consumido pela correção de decoder #1234 e teve RC publicado antes do smoke da #1233;
- **benchmark atual com evidência textual de #1413:** exige worker congelado capaz de persistir o bundle imutável, portanto `benchmark_ready` exige **Whisper `>=1.1.10`** e **Qwen `>=1.0.18`**. Whisper normal e benchmark coincidem em 1.1.10 por motivos diferentes: o primeiro por compatibilidade de protocolo; o segundo pelo contrato de evidência do benchmark.

A versão `1.1.5` nunca deve ser reconstruída, sobrescrita ou republicada com bytes novos. O reparo é sempre uma nova versão imutável.

Como `benchmark_bundles.py` e, na integração de #1414, `benchmark_diagnostics.py` são importados pelo worker empacotado, alterar qualquer um desses contratos muda bytes do runtime. Os manifests 1.1.10/1.0.18 e as fences RC/Stable incluem essa closure na decisão de build; runtimes anteriores não podem ser reclassificados como evidence-capable apenas por atualização do Agent. O Companion `0.3.18` anuncia `processing.benchmark.runtime-readiness-v2` e separa `ready` de `benchmark_ready`; consumidores antigos ou respostas sem esse contrato devem falhar fechados para benchmark, sem bloquear transcrição normal.

A preparação iniciada pelo Benchmark usa `purpose=benchmark`. Ela pode reutilizar modelos/cache já íntegros, mas só considera o runtime pronto quando a versão ativa satisfaz o contrato de benchmark. Para transcrição normal, o catálogo aplica separadamente a fence de protocolo Craig. Se a Stable instalada não satisfizer a finalidade solicitada, o fluxo pode instalar um RC `>=1.1.10` publicado e verificado; isso não autoriza promovê-lo a Stable.

O build do Whisper executa dois smokes no worker empacotado:

1. bootstrap sintético já existente;
2. comando real de protocolo `transcription.craig` com `benchmark_mode=true` e `benchmark_sample_seconds=300`, contra uma fonte sintética ausente.

O segundo smoke deve alcançar `ready` e um erro de fonte controlado. `exit 64` antes de `ready` reprova o artefato e impede repetir a regressão de `1.1.5`. O Companion também trata 1.1.5 como incompatível antes do spawn no contrato atual. Nenhum áudio privado, modelo pesado ou transcrição é necessário para esse gate de empacotamento.

### Migração e rollback

A migração preserva `State`, `Data`, `Models` e caches; somente o runtime Whisper recebe uma nova identidade/version directory. Com o contrato Craig atual, 1.1.5 não deve continuar sendo usado para jobs normais: o usuário precisa preparar um runtime Whisper `>=1.1.10` antes de voltar a transcrever. A promoção a Stable continua condicionada ao aceite físico dos bytes exatos do candidato.

Antes de promover `1.1.10` a Stable, o **archive/hash/source exatos** do RC precisam de aceite físico no Windows/GPU suportado e o benchmark real de 5 minutos deve completar os quatro perfis com lineage do runtime e GPU. CI e smoke sintético não substituem essa prova.

Rollback nunca reutiliza números de runtime: se `1.1.10` falhar no aceite, não promover. Se já houver promoção e surgir regressão, selecionar deliberadamente o artefato Stable anterior conhecido, manter benchmark fail-closed quando o contrato não puder ser satisfeito e corrigir com **nova versão**. Não retaggear, rebuildar ou sobrescrever releases existentes.
## Exceções

O candidato de metadados Craig #1565 mantém os pins já aceitos durante o rebuild
versionado Companion 0.3.22 / Qwen 1.0.19 / Whisper 1.1.11. Python 3.12.14 e
Transformers 5.18.0 continuam sob as exceções machine-readable existentes:
esta entrega altera identidade de exportação, sem juntar mudanças do interpretador
ou da inferência. Os artefatos novos exigem novo aceite físico; os receipts das
versões anteriores não são reutilizados como aprovação destes bytes.

Toda exceção precisa ser explícita e ter justificativa técnica ou legal. Exceções de dependência runtime devem ser machine-readable no manifest correspondente, vinculadas à versão pinada e rejeitadas automaticamente quando o pin divergir.

### Python/uv preservados durante os controles 0.3.17–0.3.21

As releases de controle **Companion 0.3.17–0.3.21** mantêm temporariamente Python `3.12.14` e `uv 0.12.18` embora existam patches estáveis mais novos. O motivo é reproduzibilidade: #1210 preserva a base aceita durante a recuperação do Qwen e #1233 muda o contrato/empacotamento do benchmark Whisper sem aproveitar a entrega para trocar silenciosamente o baseline Python/uv. Qualquer rebuild de runtime continua recebendo identidade e versão próprias.

A exceção do **Python** é machine-readable em `local-companion/dependency-freshness-exceptions.json`, separada dos manifests de build ASR para que uma decisão de controle/release não altere um input do pacote Qwen 1.0.12 já aceito fisicamente. A exceção de **uv** já existente continua no manifest Qwen e permanece vinculada exatamente ao pin usado pelos workflows de runtime. Trocar qualquer pin invalida automaticamente a exceção correspondente. A remoção exige uma entrega própria, com runtime versionado novo quando os bytes mudarem, build/packaging completo e gate físico aplicável.

### WiX Toolset

O MSI permanece temporariamente em WiX 5.0.2. WiX 6/7 introduzem mudança major e requisitos de licenciamento/OSMF que precisam ser avaliados antes de adotarmos a versão mais nova no pipeline. Essa retenção não autoriza deixar as demais dependências desatualizadas.

A migração de WiX deve ser testada isoladamente e só entra quando o contrato/licenciamento e os smokes de install/upgrade/uninstall/purge estiverem aprovados.

## Fontes de verdade

- Dependências Python do Companion: `local-companion/pyproject.toml`
- Lock dos testes: `local-companion/requirements-test.lock`
- Runtime Whisper Windows: `local-companion/runtime/whisper-windows-x64.json`
- Runtime Qwen Windows: `local-companion/runtime/qwen-windows-x64.json`
- Exceções de freshness do controle do Companion: `local-companion/dependency-freshness-exceptions.json`
- Perfis e revisions ASR: `local-companion/tda_companion/asr_models.py`
- Workflow do Companion: `.github/workflows/companion.yml`
- Workflow do runtime Whisper: `.github/workflows/whisper-runtime.yml`
- Workflow candidato Qwen: `.github/workflows/qwen-runtime.yml`
- Gate de versões: `.github/workflows/companion-dependency-freshness.yml`

Uma release não deve ser promovida para produção se a auditoria de versões estiver pendente ou se uma exceção necessária não estiver documentada.
