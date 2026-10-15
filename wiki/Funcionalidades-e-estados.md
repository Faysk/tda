# 🧩 Funcionalidades e estágio de desenvolvimento

**Para quem:** pessoas que querem saber o que o TDA já oferece, o que está em construção e o que é apenas uma ideia. **Este guia não é um painel de disponibilidade ao vivo.**

## Como ler um status sem se enganar

Uma feature tem pelo menos **duas dimensões distintas**:

- **Maturidade:** existe no schema/código, está preparada, teve arquitetura aprovada ou ainda é uma ideia?
- **Entrega:** está em PR, foi validada, foi integrada na main ou foi efetivamente **publicada/aplicada**?

~~~mermaid
flowchart TD
  A["Ideia ou requisito"] --> B["Contrato / arquitetura"]
  B --> C["Código / schema"]
  C --> D["Testes no SHA"]
  D --> E["Integrado em main"]
  E --> F["Publicação ou aplicação verificada"]
~~~

A passagem de uma etapa para outra **não é automática**. Ter tabela no banco não significa que a interface já esteja pronta. Uma captura demonstrativa de interface não significa que os dados de campanha sejam verdadeiros.

## Panorama guiado

| Área | O que a documentação sustenta | O que não podemos presumir |
| --- | --- | --- |
| **Campanhas e sessões públicas** | Há diretório e projeções públicas com filtros de visibilidade | Que toda campanha, sessão ou personagem esteja publicamente acessível |
| **Lembra** | Biblioteca visual compartilhada autenticada e persistência documentada em Production | Que seja wiki/canon ou armazenamento privado por campanha |
| **Companion + Craig + ASR** | Agent/Desktop, perfis Qwen/Whisper, jobs e runs locais implementados | Que concluir ASR publique qualquer coisa automaticamente |
| **Revisão e publicação de transcrições** | Runs, comparação, revisão derivada e fluxo de publish explícito descritos como implementados na main | Que a flag de publicação esteja ativa em todo ambiente |
| **Personagens, NPCs, locais, itens e facções** | Fundamentos em entities e perfis/relations em diferentes níveis de preparação | Que cada tipo já tenha página completa com conteúdo real |
| **World Explorer** | Fundação visual multi-hub e roteamento, com fixtures demonstrativas | Que toda relação exibida seja canon real revisado |
| **Lore e diários** | Experiências editoriais independentes e publicações específicas | Que uma obra publicada crie automaticamente entities ou canon |
| **Knowledge/audience narrativo** | Problema e direção documentados; exige separar rumor, mentira e segredo do mestre | Que todo o modelo de “quem sabe o quê” já esteja concluído |
| **Busca semântica e mapas** | Direções registradas para evolução futura | Que existam motores, coordenadas ou busca vetorial prontos para uso |
| **Intents** | O catálogo registra conceito sem definição canônica localizada | Que exista API/schema para intents |

**Atenção ao escopo:** o registry de campanhas pode estar operacional enquanto **todos** os fluxos de workspaces multi-campaign ainda não foram concluídos. Do mesmo modo, “implementado no schema” não equivale a uma experiência completa para o usuário.

## Três situações comuns

### Quero saber se posso usar agora

Veja primeiro a página de produto e experimente somente **as superfícies públicas**. A disponibilidade do recurso pode variar por campanha, autorização e ambiente. Consulte [o guia de uso](https://github.com/Faysk/tda/wiki/Usando-o-TDA).

### Quero desenvolver uma feature

Confirme seu documento dono, maturidade do contrato, migrações já aplicadas, dependencies, issues abertas e gates. Um item histórico em lista de desejos não é especificação atual. Consulte [como contribuir](https://github.com/Faysk/tda/wiki/Desenvolvimento).

### Quero saber se o recurso está publicado em Production

Confirme o documento dono e a evidência de release do SHA/artefato/ambiente. Uma PR com CI verde não basta; veja [operações e releases](https://github.com/Faysk/tda/wiki/Operacoes-e-releases).

## Fontes e atualização

Este quadro é um resumo didático baseado no [catálogo canônico de features](https://github.com/Faysk/tda/blob/main/docs/feature-catalog.md) (revisão declarada em **05/10/2026**) e em documentos donos. É uma **fotografia editorial**, não uma promessa de que cada célula permanece atual após novos commits.

Para verificar o estado mais recente, dê prioridade ao [índice técnico atual](https://github.com/Faysk/tda/blob/main/docs/README.md), às specs de cada área e aos receipts de entrega. Se houver aparente contradição entre um resumo e uma fonte mais recente, reporte em [#1745](https://github.com/Faysk/tda/issues/1745) para revisão.

Continue: [Índice](https://github.com/Faysk/tda/wiki/Indice) · [Dúvidas comuns](https://github.com/Faysk/tda/wiki/Perguntas-frequentes) · [Glossário](https://github.com/Faysk/tda/wiki/Glossario).
