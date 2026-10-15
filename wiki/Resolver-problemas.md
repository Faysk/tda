# 🧯 Resolução de problemas — por sintoma

> **Para quem:** leitores, jogadores, editores e contribuidores. **Princípio:** começar com verificações seguras, sem alterar dados privados nem executar comandos administrativos por tentativa e erro.

## Primeiro, identifique a área

| O que aconteceu? | Primeiro caminho |
| --- | --- |
| Não aparece uma campanha ou sessão | [Campanhas e sessões](https://github.com/Faysk/tda/wiki/Campanhas-e-sessoes) |
| Consegui login mas Edit não aparece | [Permissões e escopo](https://github.com/Faysk/tda/wiki/Seguranca-e-permissoes) |
| O grafo mostra somente demonstrações | [World Explorer e relações](https://github.com/Faysk/tda/wiki/Explorar-o-World-Explorer) |
| Lembra não encontra uma imagem | [Busca, filtros e mídia no Lembra](https://github.com/Faysk/tda/wiki/Usar-o-Lembra) |
| Não consigo conectar Companion | [Agent local, runtime e versões](https://github.com/Faysk/tda/wiki/Companion-e-IA) |
| O processamento foi interrompido | [Retry e recuperação segura](https://github.com/Faysk/tda/wiki/Resultados-locais-e-exclusao) |
| Duas gravações parecem repetidas | [Gaps, overlaps e assembly](https://github.com/Faysk/tda/wiki/Multiplas-gravacoes) |
| A transcrição terminou, mas não está pública | [Revisão e publicação explícita](https://github.com/Faysk/tda/wiki/Edit-e-revisao) |
| O resultado ASR está incorreto | [Medição objetiva e revisão humana](https://github.com/Faysk/tda/wiki/Qualidade-ASR) |
| Link de lore ou imagem não abre | [Publicação/listagem](https://github.com/Faysk/tda/wiki/Publicar-uma-Lore) e [entrega de mídia](https://github.com/Faysk/tda/wiki/Midia-e-assets) |
| Após merge, não vejo mudança no site | [Entrega por SHA e recibos](https://github.com/Faysk/tda/wiki/Operacoes-e-releases) |

## Quatro perguntas que evitam falsos diagnósticos

1. **Onde está o problema?** Web pública, Edit, Companion instalado, artefato de mídia ou documentação?
2. **Qual é o estado esperado?** A funcionalidade está publicada, em candidate/PR, depende de flag ou precisa de permissão?
3. **O que já foi confirmado?** Link, mensagem de erro, status do job, SHA do artefato ou versão do Agent?
4. **A ação pode destruir dados?** Se sim, pare e consulte o documento operacional antes de fazer qualquer coisa.

~~~mermaid
flowchart TD
  A["Encontrou um erro"] --> B{"É recurso público?"}
  B -->|Sim| C["Checar estado publicado, campanha e link"]
  B -->|Não| D["Checar login, capability e ambiente"]
  C --> E{"Envolve job ou mídia?"}
  D --> E
  E -->|Job local| F["Preservar fonte/run e consultar recovery"]
  E -->|Mídia| G["Checar URL, MIME e integridade"]
  E -->|Não| H["Registrar reprodução segura"]
  F --> H
  G --> H
  H --> I["Issue com evidência sanitizada"]
~~~

O fluxograma é um roteiro didático de triagem, não um diagnóstico automático do produto.

## O que NÃO fazer

- Não inserir chaves de Supabase, tokens ou links de conteúdo privado numa issue.
- Não usar uma role administrativa para “testar se passa” nem abrir RLS permissiva em produção.
- Não apagar pastas de dados do Companion, runs ou media para corrigir um indicador de interface.
- Não forçar uma publicação por SQL quando o Edit sinaliza falta de autorização ou revisão.
- Não substituir um asset 404 por arquivo parecido sem conferir origem, hash e aprovação.
- Não interpretar um 404 privado como autorização para enumerar URLs e IDs.

## Como abrir uma issue útil sem dados privados?

Inclua o caminho público ou nome da tela, passos objetivos, **comportamento esperado versus observado**, versão/SHA quando conhecido e um exemplo **sintético** que reproduza o problema. Se a evidência original contiver nomes de pessoas, áudios privados ou tokens, não a publique.

## Documentação técnica de apoio

[Operação do Companion](https://github.com/Faysk/tda/blob/main/docs/operations/local-companion.md) · [Releases e rollback](https://github.com/Faysk/tda/blob/main/docs/operations/release-runbook.md) · [Segurança](https://github.com/Faysk/tda/blob/main/docs/database/security.md) · [Diagnóstico de mídia](https://github.com/Faysk/tda/blob/main/docs/integrations/r2/media-pipeline.md) · [Documentação viva](https://github.com/Faysk/tda/blob/main/docs/documentation/README.md).

Acompanhe ou reporte no [backlog do TDA](https://github.com/Faysk/tda/issues), com os cuidados de privacidade indicados.

Voltar: [Início](https://github.com/Faysk/tda/wiki/Home) · [Índice completo](https://github.com/Faysk/tda/wiki/Indice) · [Perguntas frequentes](https://github.com/Faysk/tda/wiki/Perguntas-frequentes)
