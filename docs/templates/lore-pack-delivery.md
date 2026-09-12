# Modelo — entrega de pacote de lore

> Status: modelo manual; não é schema de importador implementado
> Owner: frontend / integrations/media / operations
> Última revisão: 2026-09-12

Copiar para o documento da entrega e preencher com evidências reais. Campos vazios continuam pendentes. Procedimento: [ZIP à produção](../operations/zip-to-production.md).

## Identificação

- Lore / responsável:
- ZIP / revisão / SHA-256 / bytes:
- Origem oficial / data:
- Slug e URL pretendida:
- Listar em `/lore`: sim/não, decisão:
- Campanha/universo: confirmado ou sem vínculo:
- Referência visual aprovada:
- Fontes externas, dependências e restrições conhecidas:
- Título / descrição / arte social:
- Responsável por mídia / integração / release:

## Inventário de arquivos

Uma linha por arquivo, incluindo camadas, fontes, ícones, galeria e mídia tardia. Não registrar segredos nem URLs privadas assinadas neste documento público.

| Original | Tipo real / bytes / dimensões / alpha | SHA-256 | Uso | Fonte do derivado / parâmetros | Destino / URL pública | Read-back / GET / decode | Consumidor validado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Preencher | Preencher | Preencher | Preencher | Preencher | Preencher | Pendente | Pendente |

Exemplo de campos de manifesto, **somente modelo**; substituir placeholders e adaptar aos tipos de arquivo. Não chamar esses dados de recibo antes de verificar:

```json
{
  "schemaVersion": 1,
  "slug": "SUBSTITUIR",
  "archiveSha256": "PENDENTE",
  "entrypoint": "index.html",
  "listed": false,
  "assets": [{
    "sourcePath": "assets/images/hero-subject.webp",
    "role": "hero-subject",
    "sha256": "PENDENTE",
    "bytes": null,
    "width": null,
    "height": null,
    "hasAlpha": null,
    "consumers": ["index.html"],
    "publicUrl": null,
    "readbackVerifiedAt": null,
    "publicDecodeVerifiedAt": null,
    "browserVerifiedAt": null
  }]
}
```

## Fases e entregáveis

- [ ] ZIP preservado e extração segura; referência local aberta.
- [ ] Inventário completo; nenhuma referência necessária sem destino.
- [ ] Masters preservados na cloud privada com read-back.
- [ ] Derivados e qualidade aprovados; proporções/camadas mantidas.
- [ ] Todos os objetos necessários conferidos por download e decode.
- [ ] HTML/CSS/JS integrados; diferenças do original registradas.
- [ ] Desktop/mobile, galeria, navegação, falhas e movimento reduzido conferidos.
- [ ] Checks/build/testes requeridos concluídos; skips documentados.
- [ ] PR Preview revisada e integrada.
- [ ] PR main revisada e integrada; SHA exato identificado.
- [ ] Publicação terminal bem-sucedida; versão do domínio confirmada.
- [ ] Consumidores públicos conferidos com URLs e dimensões corretas.
- [ ] Recibo final e rollback registrados; pendências separadas.

## Adaptações e inspeção visual

- Diferença do pacote / motivo / evidência antes/depois:
- Viewports e navegador verificados:
- URL efetiva e resolução de cada cena:
- Peso inicial / carregamento tardio / limites conhecidos:
- Aprovação visual / data:

## Recibo de release

- PR implementação / promoção:
- Commit e release:
- Execução CI / resultado / testes ignorados:
- Execução publicação / resultado:
- `/api/version` observado em:
- URLs públicas e inspeção realizada em:
- Referência anterior e procedimento de rollback:
- Pendências, responsável e próxima ação:

Atualizar o estado por fase. `Preparado`, `enviado`, `integrado`, `publicado` e `verificado no domínio` são marcos diferentes.
