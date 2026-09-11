# Companion — operação, instalação e rollback

> Status: implementação candidata validada em CI Windows/Linux
> Owner: local-companion/processing
> Última revisão: 2026-09-11

Referências: [contrato API](../integrations/local-companion-v1.md), [integração](../integrations/local-companion.md) e [processamento no Edit](../features/local-processing.md).

## Decisão de processo Windows

O TDA Companion é um aplicativo **novo e independente** do antigo `DnDScribeCompanion.exe`. O produto não consulta, inicia, encerra, modifica ou depende de `%LOCALAPPDATA%\DnDScribe`.

O supervisor roda por usuário na sessão interativa do Windows, sem serviço de sistema e sem privilégios administrativos. Ele escuta somente `127.0.0.1:8765`, possui token próprio e mantém instalação e dados separados:

```text
%LOCALAPPDATA%\TDA\Companion
%LOCALAPPDATA%\TDA\Data
```

Logoff encerra o processo; ao iniciar novamente, a fila persistida é recuperada conforme o protocolo. Não há promessa de processamento sem usuário logado.

## Instalador Windows

O pacote oficial é `TDACompanion-x64.msi`, produzido com WiX Toolset e validado em runner Windows antes de poder ser publicado.

O MSI:

- instala por usuário, sem elevação administrativa;
- instala a versão em `%LOCALAPPDATA%\TDA\Companion\versions\<versão>`;
- mantém `%LOCALAPPDATA%\TDA\Companion\current-version.txt`;
- cria atalho `TDA Companion` no Menu Iniciar;
- preserva `%LOCALAPPDATA%\TDA\Data` durante atualização/desinstalação;
- não cria Windows Service;
- não habilita Startup automático;
- não toca na instalação antiga do DnDScribe.

O ZIP portátil continua sendo produzido como alternativa técnica, mas o MSI é o caminho recomendado para o produto.

### Gate do MSI

O workflow `.github/workflows/companion.yml` executa, em Windows real de CI:

1. build do bundle PyInstaller;
2. build de `TDACompanion-x64.msi`;
3. smoke do executável empacotado;
4. instalação silenciosa do MSI;
5. verificação do executável e marcador de versão instalados;
6. inicialização do Companion instalado em porta de ensaio;
7. health check da API;
8. encerramento da instância criada pelo teste;
9. desinstalação silenciosa;
10. confirmação de remoção do executável.

Falha em qualquer passo impede a publicação do pacote.

## Distribuição e versão mais recente

Em `main`, depois dos gates Windows/Linux, o workflow publica uma GitHub Release imutável:

```text
companion-v<versão>
```

Assets:

```text
TDACompanion-x64.msi
TDACompanion-x64.msi.sha256
TDACompanion-<versão>-windows-x64.zip
```

O nome estável do MSI permite que o site use sempre:

```text
https://github.com/Faysk/tda/releases/latest/download/TDACompanion-x64.msi
```

Assim o frontend não precisa ser alterado a cada versão. Qualquer mudança de release do Companion exige incremento da versão em `local-companion/pyproject.toml`; uma tag já publicada não é sobrescrita.

## Pareamento

Na primeira execução, o aplicativo gera um token aleatório local e restringe o arquivo ao usuário do Windows. O aplicativo permite copiar esse token e abrir `/edit/processamento`.

O browser mantém o token apenas na memória da aba. O token não é cookie, não vai para query string, storage, logs ou cloud. Recarregar a aba exige novo pareamento.

## Assinatura

O MSI atual é funcional e passa instalação/desinstalação em CI, mas **não há assinatura Authenticode configurada neste corte**. Não apresentar o pacote como publisher assinado enquanto certificado e pipeline de assinatura não existirem. Assinatura de código é uma evolução de distribuição, não deve ser simulada.

## ASR e limites atuais

A aplicação Windows hospeda supervisor, fila, API, eventos e telemetria reais, mas o workload HTTP habilitado neste corte continua sendo `synthetic.fixture`.

Os módulos preservados de ASR (`transcriber.py`, runtime e artefatos associados) permanecem fonte para o adapter de transcrição, porém ainda não estão conectados ao supervisor HTTP. O MSI não muda esse limite e não deve gerar progresso de transcrição fictício.

Continuam fora deste corte:

- ASR real ponta a ponta;
- atualização automática em background;
- assinatura Authenticode;
- sincronização/publicação cloud automática;
- Windows Service;
- Startup automático.

## Segurança operacional

A API continua restrita a IPv4 loopback, Host exato, origens explicitamente permitidas e Bearer em endpoints privados. POST exige Origin permitido e JSON. Não há descoberta de outros computadores, URL arbitrária ou proxy cloud.

Falha de telemetria não degrada a fila. O processo usa lock da raiz de dados; uma segunda instância com a mesma raiz deve falhar em vez de matar outra instância. Porta ocupada também não autoriza descobrir ou encerrar PID externo.

## Atualização

Antes de instalar uma versão nova, o usuário deve encerrar o TDA Companion em execução. O MSI usa upgrade versionado e os dados ficam fora do diretório de versão, portanto uma atualização do aplicativo não deve apagar fila, token ou dados persistidos.

## Rollback

Rollback do aplicativo significa instalar uma versão compatível em pacote separado e manter a raiz de dados preservada. O schema local não deve ser rebaixado in-place. Para mudanças de schema futuras, produzir snapshot consistente e migração versionada antes de trocar a versão ativa.

O antigo `DnDScribeCompanion.exe` **não é mecanismo de rollback** e não participa da arquitetura atual.

## Gates de validação

Antes de promover uma versão do Companion:

```text
python -m pytest local-companion/tests -q
pnpm check
pnpm build
pnpm test:processing
```

Além disso, o workflow `Companion` deve ficar verde em Windows e Linux, e o job `windows-installer (TDACompanion-x64.msi)` deve passar build, instalação, execução, health e desinstalação.

CI/build verde valida empacotamento e contratos sintéticos; não mede qualidade ASR, throughput Whisper, CUDA/modelos ou precisão de diarização.
