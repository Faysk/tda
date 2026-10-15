# 🗺️ Campanhas, rotas e links permanentes

> **Para quem:** visitantes, jogadores e desenvolvedores de interfaces e integrações. **Objetivo:** entender por que a campanha é importante em cada URL e por que nomes não devem ser tratados como IDs permanentes.

## Uma campanha tem mais de um nome

O TDA diferencia **identidade relacional**, **identificador técnico**, **nome mostrado na tela** e **rota pública**. Uma campanha pode trocar de título sem perder histórico ou quebrar referências de sessões.

| Identidade | Uso | Exemplo do contrato atual |
| --- | --- | --- |
| UUID | Identidade interna de relacionamentos | Não se usa como título |
| Technical slug | Compatibilidade e consumidores internos | `yuhara-main` |
| Nome público | Apresentação humana editável | **Destino Sem Fim** |
| Public route key | Navegação compartilhável | `destino-sem-fim` |

O contrato atualizado também registra a campanha **Passos Retomados** (`antes-que-seja-tarde`; rota `passos-retomados`). Identidade cadastrada **não prova** que haja sessões, personagens, canon ou publicação para ela. O estado de descoberta depende de visibilidade e lifecycle.

## Onde ficam as sessões?

~~~mermaid
flowchart TD
  A["/campanhas"] --> B["/campanhas/campaign"]
  B --> S["/campanhas/campaign/sessoes"]
  S --> D["/campanhas/campaign/sessoes/sessionId"]
  A --> ALL["/campanhas/sessoes · arquivo público agregado"]
~~~

O texto `campaign` e `sessionId` no desenho representam parâmetros, não uma URL literal para copiar.

- `/campanhas`: diretório de campanhas públicas e ativas.
- `/campanhas/[campaign]`: hub de uma campanha, quando descobrível.
- `/campanhas/[campaign]/sessoes`: arquivo de sessões daquela campanha.
- `/campanhas/[campaign]/sessoes/[sourceSessionId]`: detalhe de uma sessão publicada.
- Rotas legadas como `/sessoes` são caminhos de compatibilidade, não o formato preferido de novos links.

## Segurança da navegação

Uma URL correta **não autoriza** acesso. O servidor resolve a campanha, valida permissões, filtra conteúdos e evita que um identificador de source seja tratado como global quando pode ocorrer em mais de uma campanha.

Se uma campanha não aparecer no diretório, não deduza que tenha sido excluída: pode estar privada, arquivada ou indisponível. O navegador não deve tentar enumerar UUIDs ou modificar slugs para contornar visibilidade.

## Exemplos úteis

- Para começar sem saber a rota: abra [Campanhas](https://dnd.faysk.dev/campanhas).
- Para criar um link dentro de uma app: use a identidade **pública e canônica** da campanha, não o título humano nem um technical slug de backend.
- Para diagnosticar redirecionamento: veja aliases/compatibilidade no contrato atual, não invente redirect para toda URL antiga.

**Fonte canônica:** [Arquitetura e rotas de campanhas](https://github.com/Faysk/tda/blob/main/docs/architecture/multi-campaign.md) · [Diretório público](https://github.com/Faysk/tda/blob/main/docs/features/campaign-directory.md) · [Dados de sessões](https://github.com/Faysk/tda/blob/main/docs/domains/sessions.md) · [Capacidades e isolamento](https://github.com/Faysk/tda/blob/main/docs/domains/identity-access.md).

Continue: [Campanhas e sessões](https://github.com/Faysk/tda/wiki/Campanhas-e-sessoes) · [Permissões](https://github.com/Faysk/tda/wiki/Seguranca-e-permissoes)
