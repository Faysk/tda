# 🏗️ Arquitetura do TDA

**Para quem:** leitores curiosos e novos contribuidores. **Em uma frase:** o TDA separa o site cloud do trabalho pesado local e mantém evidências/regras de publicação explícitas.

~~~mermaid
flowchart TB
  U["Leitor ou editor"] --> Web["TDA Web · Next.js"]
  Web --> DB["Supabase · PostgreSQL e Auth"]
  Web --> R2["Cloudflare R2 · Media Storage"]
  U --> Agent["Companion local · Windows"]
  Agent --> ASR["ASR Qwen / Whisper"]
  ASR --> Runs["Runs e revisão"]
  Runs -.->|"publish autorizado"| Web
  GH["GitHub · CI e release controlada"] --> Web
~~~

O projeto segue **núcleo portátil e integrações substituíveis**. Os provedores citados são os atuais, mas o modelo narrativo não pertence a eles.

| Área | Responsabilidade | Limite |
| --- | --- | --- |
| Web / Next.js | Apresentação, Edit, API pública | Não roda ASR pesado do usuário |
| Supabase / PostgreSQL | Dados relacionais, Auth, RLS | Não é armazenamento de arquivos de mídia |
| R2 / Media Storage | Binários persistidos/publicados | Não concede canon ou acesso |
| Companion | Processamento e recuperação no PC | Não publica automaticamente |
| GitHub Actions | Gates, artefatos e promoção controlada | Merge não significa deploy |

## Cinco invariantes essenciais

1. Conteúdo de IA e evidência **não viram canon** sem revisão.
2. Autorização verifica **capabilities, escopo e campanha** no servidor.
3. Mídia tem fronteira própria; a base contém as relações e metadados.
4. O site funciona mesmo com Companion offline, para conteúdo já publicado.
5. Branch, CI, main e publicação exigem distinção e evidência.

## Aprofunde por assunto

- [Contexto do sistema](https://github.com/Faysk/tda/blob/main/docs/architecture/system-context.md)
- [Fluxos ponta a ponta](https://github.com/Faysk/tda/blob/main/docs/architecture/data-flows.md)
- [Invariantes](https://github.com/Faysk/tda/blob/main/docs/architecture/invariants.md)
- [Modelo de dados](https://github.com/Faysk/tda/blob/main/docs/data-model.md)
- [Campanhas e isolamento](https://github.com/Faysk/tda/blob/main/docs/architecture/multi-campaign.md)
- [ADRs e decisões aceitas/superadas](https://github.com/Faysk/tda/blob/main/docs/adr/README.md)

Continue: [Desenvolvimento](https://github.com/Faysk/tda/wiki/Desenvolvimento) · [Integrações](https://github.com/Faysk/tda/wiki/API-e-integracoes)
