# 🔌 API e integrações

**Para quem:** quem quer consumir dados públicos ou entender os provedores de serviço.

## API pública de sessões

O TDA documenta endpoints de **leitura de sessões publicadas**:

- **GET /api/public/sessions** — lista paginada, com filtro de campanha.
- **GET /api/public/sessions/{campaign}/{sessionId}** — detalhe publicado, inclusive resumo integral quando disponível.

~~~bash
curl -i 'https://dnd.faysk.dev/api/public/sessions?limit=10'
~~~

A listagem retorna dados e paginação. **Não** fornece áudio, transcrições brutas, drafts, participantes privados ou métricas internas. Leitura pública não requer token; CORS de browser cross-origin não está liberado por padrão. O contrato explica limites, erros, cache e identificação por campanha + sessão: [API pública v1](https://github.com/Faysk/tda/blob/main/docs/api/public-sessions.md).

## Integrações principais

~~~mermaid
flowchart LR
  Web["TDA Web"] --> DB["Supabase · PostgreSQL/Auth"]
  Web --> R2["Cloudflare R2"]
  GH["GitHub Actions"] --> Ve["Vercel"]
  Ve --> Web
  Cr["Craig/Discord"] --> Co["Companion local"]
  Co --> Re["Revisão humana"]
  Re -.->|"publicação explícita"| Web
~~~

- **Supabase:** banco, autenticação e fronteiras de acesso.
- **R2:** armazenamento de mídia aprovado/verificado.
- **Vercel:** runtime web; a entrega é governada por GitHub Actions.
- **Craig/Discord/Roll20:** fontes externas; evento não é automaticamente canon.
- **Companion:** API de loopback local, não endpoint de internet.

**Nunca compartilhe credenciais, URLs privadas ou service role nesta Wiki.** Use exemplos sintéticos; valide permissão no servidor e não presuma que uma API privada é estável para consumo externo.

## Referências

[Integrações](https://github.com/Faysk/tda/blob/main/docs/integrations/README.md) · [R2](https://github.com/Faysk/tda/blob/main/docs/integrations/r2.md) · [Supabase](https://github.com/Faysk/tda/blob/main/docs/integrations/supabase.md) · [Vercel](https://github.com/Faysk/tda/blob/main/docs/integrations/vercel.md) · [Loopback](https://github.com/Faysk/tda/blob/main/docs/integrations/local-companion-v1.md) · [Fontes de mesa](https://github.com/Faysk/tda/blob/main/docs/integrations/table-sources.md)

Próximo: [Arquitetura](https://github.com/Faysk/tda/wiki/Arquitetura) · [Glossário](https://github.com/Faysk/tda/wiki/Glossario)
