# 🤖 Companion e inteligência artificial local

**Para quem:** editores e interessados no processamento de gravações. **Não é preciso instalar nada para ler conteúdo público.**

O **TDA Companion** executa tarefas pesadas no computador Windows, preservando gravações e resultados locais. Ele combina aplicativo Desktop, Agent local, fila de jobs e workers com motores de reconhecimento de fala (ASR), como Qwen e Whisper.

~~~mermaid
flowchart LR
  W["Navegador / Edit"] <-->|"conexão local"| A["Agent"]
  A --> F["Fila de jobs"]
  F --> R["Worker Qwen ou Whisper"]
  R --> L["Runs locais preservados"]
  L --> V["Revisão humana"]
  V -.->|"ação autorizada"| P["Publicação explícita"]
~~~

**O processamento concluído NÃO publica automaticamente.** O Agent usa conexão loopback no computador; a Web cloud continua disponível quando o PC de processamento está desligado.

## Componentes

| Termo | Significado |
| --- | --- |
| Desktop | Interface Windows para controle e observação |
| Agent | Serviço local e protocolo de conexão com o navegador |
| Worker | Processo separado que executa o job de ASR |
| Runtime | Modelos e dependências de Qwen ou Whisper |
| Perfil | Configuração selecionada para processar áudio |
| Run | Resultado imutável de uma tentativa de job |
| API v1 | Versão de protocolo; não é a versão do instalador |

O contrato menciona perfis **qwen-quality**, **qwen-fast**, **whisper-detailed** e **whisper-turbo**. Compatibilidade e disponibilidade dependem dos runtimes e versões instaladas.

## Primeiro uso com segurança

1. Confirme acesso autorizado à campanha e ao Edit.
2. Consulte [o runbook oficial](https://github.com/Faysk/tda/blob/main/docs/operations/local-companion.md) para o **instalador e versão corretos**. Não fixe uma URL de MSI antiga nesta Wiki.
3. Confirme que Agent e runtime escolhido estão prontos.
4. Use a interface do Edit para conectar e submeter uma fonte permitida.
5. Acompanhe status, cancelamento/retry e runs; revise o texto antes de pensar em publicar.

**Se der erro:** não exponha a porta local à rede, não apague jobs/gravações por tentativa e erro, não confunda API v1 com versão MSI, nem resultado sintético com aceite físico em GPU real.

## Fontes canônicas

[Companion](https://github.com/Faysk/tda/blob/main/docs/integrations/local-companion.md) · [Protocolo local](https://github.com/Faysk/tda/blob/main/docs/integrations/local-companion-v1.md) · [Processamento Web](https://github.com/Faysk/tda/blob/main/docs/features/local-processing.md) · [Instalação e recuperação](https://github.com/Faysk/tda/blob/main/docs/operations/local-companion.md) · [Publicação editorial](https://github.com/Faysk/tda/blob/main/docs/features/transcript-review-publication.md)

Próximo: [Edit e revisão](https://github.com/Faysk/tda/wiki/Edit-e-revisao) · [Perguntas frequentes](https://github.com/Faysk/tda/wiki/Perguntas-frequentes)
