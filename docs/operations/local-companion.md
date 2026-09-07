# Companion — operação, migração e rollback

> Status: preparado; base executável sintética em branch/PR
> Owner: local-companion/processing
> Última revisão: 2026-09-07

Referências: [contrato API](../integrations/local-companion-v1.md), [integração](../integrations/local-companion.md).

## Decisão de processo Windows

Executar supervisor Python por usuário na sessão interativa, com token/raiz próprios, sem admin. GPU, seletor de arquivos e futuro tray pertencem ao usuário; Windows Service/Session 0 acrescentaria identidade, ACL e desktop separados sem necessidade para esta entrega. Logoff encerra processamento e restart recupera fila; operação sem login não é prometida. O tray legado não foi copiado: encerra PID lido em runtime JSON e o instalador modifica Startup/encerra processos, incompatível com o ensaio autorizado.

Este corte entrega CLI instalável em venv isolado e wheel, supervisor/fila/API e plano JSON de instalação **somente dry-run**. Ainda não entrega instalador gráfico, startup automático, atualização automática, assinatura Authenticode ou ASR conectado. Não executar migração em dados existentes a partir deste PR.

## Inventário revalidado em 2026-09-07

Inspeção read-only de código `D:/Projects/dnd/local-companion` (projeto 0.4.0) confirma FastAPI, faster-whisper 1.2.1, CTranslate2 4.8.1, checkpoints/signature por faixa, atomic replace Windows com retries e progresso por callbacks. Perfis fast large-v3-turbo e detailed large-v3 possuem revisões de modelo fixas em runtime.py; GPU float16/fallback int8_float16, CPU apenas explícita.

`CompanionTray.cs` inicia uvicorn em 127.0.0.1:8765 e consulta estado; `CompanionSetup.cs` separa versões/runtime/dados mas escreve atalhos de Startup e encerra processos. `main.py` usa companion-runtime.json com PID. Esses comportamentos foram lidos, não executados. Em `E:/Project/craig-to-text` só foi observada pasta data, sem fonte; nenhum conteúdo de dados foi aberto. Não foi lido token, áudio, modelo, transcrição ou banco do usuário.

Cinco módulos do motor foram preservados byte a byte em `local-companion/tda_companion/legacy`: transcriber/runtime/fs/artifacts/publication; hashes no [manifesto](../../local-companion/legacy-hashes.json). Não copiamos main/storage/updater/tray. Imports pesados continuam lazy. Publication é reutilizado pela fixture; engine existente permanece primeira opção para adapter real futuro, sem reconstrução de ASR.

## Stack e evidência de versões

Consultado PyPI JSON em 2026-09-07: [FastAPI](https://pypi.org/project/fastapi/) 0.141.1, [Uvicorn](https://pypi.org/project/uvicorn/) 0.52.4, [faster-whisper](https://pypi.org/project/faster-whisper/) 1.2.1, [CTranslate2](https://pypi.org/project/ctranslate2/) 4.8.2, httpx 0.28.1, pytest 9.1.1. HTTP stack atualizada e validada sinteticamente. ASR extra fixa as versões estáveis verificadas, mas não foi instalado/carregado: compatibilidade real de GPU/CUDA permanece gate aberto. DLLs NVIDIA e modelos existentes não foram modificados.

Python 3.12.13 já disponível em runtime isolado foi usado; faixa >=3.12,<3.13 preserva limite de compatibilidade declarado pelo legado (<3.13), não acompanha preview 3.15 instalado no host. Não é alegação de última versão global de Python. Node do projeto mantém exceção 24; não há troca de stack web. `requirements-test.lock` registra toda resolução de teste; instalar com constraints para reproduzir. Warnings de depreciação do TestClient/httpx/AnyIO são conhecidos, sem falha de teste; futura migração de cliente deve ter ensaio independente.

## Ensaio reproduzível em ambiente descartável

Usar clone isolado e Python 3.12 existente. Não apontar raiz para instalação/arquivos antigos. Comandos a partir da raiz do repo, com executável do venv de teste já criado:

```powershell
python -m pip install -c local-companion/requirements-test.lock -e './local-companion[test]'
python -m pytest local-companion/tests -q
python -m pip wheel ./local-companion --no-deps --wheel-dir work/wheelhouse
./local-companion/packaging/plan.ps1 -InstallRoot "$PWD/work/app" -DataRoot "$PWD/work/data"
```

O plano não cria diretórios, baixa runtime, escreve registro/Startup, instala serviço ou encerra processo. Wheel inclui motor preservado mas apenas supervisor/fixture podem ser acionados pela API. SHA256 deve ser calculado sobre wheel exato e mantido junto ao pacote; hash não substitui assinatura de publisher.

Para teste real de HTTP sintético, operador cria token de teste em scratch e inicia `python -m tda_companion --data-root <scratch-novo> --token-file <arquivo-de-token> --origin http://127.0.0.1:<porta-do-painel> --port 18765`. Token deve corresponder a `secrets.token_urlsafe(32)` e não ir em argumento/URL/log. Não usar 8765 no ensaio compartilhado. Encerrar só a instância criada para teste. `DATA_ROOT_IN_USE` significa outro supervisor mantém lock; não apagar lock nem matar PID encontrado. Porta ocupada exige outra porta de ensaio, não encerramento do ocupante. `DATABASE_VERSION_UNSUPPORTED` exige versão compatível/snapshot; nunca resetar banco.

## Migração futura — antes de habilitar dados reais

1. Inventariar versões/caminhos e estado da instalação existente sem ler conteúdo privado. Operador para o legado pela própria UI e confirma ausência de trabalho ativo.
2. Criar cópia preservada de dados/config com hashes e manifest, inclusive modelos/revisões/reviews/checkpoints. Não mover nem converter fonte original. Guardar credenciais separadamente com ACL por usuário.
3. Instalar nova versão em diretório versionado distinto e criar raiz nova com permissões restritas; ensaiar fixture e lock/porta. Nunca importar token antigo como credencial cloud.
4. Adapter real deve mapear source recording_id, session/campaign autorizados, hashes, modelo/revisão/config para checkpoints/idempotência. Importador versionado deve oferecer dry-run, colisões explícitas e receipt, sem renomear identidades silenciosamente. Esse importador ainda não existe.
5. Operador testa amostra pequena autorizada com engine/modelo existente, qualidade/tempo/RAM/VRAM, cancelamento entre callbacks, recuperação, publicação em destino de teste com receipt idempotente. Comparar antes/depois e registrar evidência; só então habilitar workload real.

## Rollback

Para esta base, rollback é parar instância nova e voltar a executar versão anterior com sua raiz original intacta. Guardar raiz nova para diagnóstico, não apagar. Schema SQLite 1 é recusado por versão incompatível, nunca rebaixado in-place. Para upgrade futuro: snapshot consistente com supervisor parado (ou SQLite backup API), migração versionada para cópia e gate antes de trocar versão ativa. Restaurar snapshot compatível em raiz separada e conservar dados produzidos após snapshot para reconciliação; não perdê-los sob nome rollback. Nenhum passo deste plano foi aplicado no PC.

## Gates e limites

Testes sintéticos cobrem HTTP/auth/CORS/Host, idempotência concorrente, claim único, cancel/fence, crash real de subprocesso após checkpoint, restart/retry, lock de SO, progresso/resultado transacional e hash legado. Teste de encerramento abrupto usa somente processo filho de fixture, nunca processo real do usuário.

Permanecem abertos: transcrição física, compatibilidade CUDA/modelos, ingestão real, migração de dados, experiência de tray, instalação/ACL automática, HTTPS→loopback no browser do operador, sync com autorização/receipt e atualização assinada. CI/build verde não fecha esses gates. Nenhum áudio/modelo foi carregado ou enviado; site cloud não ganhou dependência deste daemon.

## Evidência integrada e ownership dos gates

Fixture canônica compartilhada: [health/job/result gerados pelo exporter](../../local-companion/tests/fixtures/companion-v1.json); regenerador `local-companion/tests/write_fixture.py`. Testes verificam identidade e hashes sem áudio. Painelzinho confirmou ensaio integrado de pairing, job succeeded, export, desconectar/reconectar preservando fila; também HTTPS de teste com permissão Local Network Access, requests loopback reais, health200/auth401/capabilities200/lifecycle200 e origem hostil bloqueada. Isso valida browser controlado, não todas as políticas/instalações do operador.

| Gate aberto | Responsável | Critério verificável |
| --- | --- | --- |
| Habilitar motor real | Motorzinho/local-companion | Adapter usa módulos/revisões existentes; amostra autorizada mede qualidade/tempo/VRAM e prova cancel/crash/retry sem duplicação de transcript |
| Instalação/migração | Motorzinho + operador | Pacote assinado, ACL token por usuário, dry-run comparado à instalação descartável, import receipt e rollback preservam hashes/dados antigos |
| Recibo cloud | Carteiro + Cofrinho/Chaveiro | Consumer valida bytes canônicos, identidade/capability/scope e grava receipt durável; replay exato não duplica, conflito rejeita; sem inferir grant de local.process |
| Habilitar sync na UI | Painelzinho + Carteiro | Ensaio integrado com receipt durável e falha/retry; somente depois capability sync=true |

Primeiro CI: web e Linux passaram no SHA 8405931. Windows falhou antes dos testes: actions/setup-python não disponibiliza 3.12.13 para Windows2025. Operação corrigida usa uv 0.12.10 / setup-uv v10.0.1 em runner efêmero, obtendo o mesmo Python3.12.13; não instala no PC. Setuptools84.0.0 também verificado no PyPI. Status terminal do SHA final pertence à PR #57, não se infere desse ensaio anterior.
