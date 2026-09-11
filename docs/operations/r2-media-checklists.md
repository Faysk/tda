# R2 — checklists de mídia

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-11

## Antes do upload

- identidade canônica confirmada;
- audience e role aprovados;
- fonte/provenance registrada;
- SHA-256, MIME, bytes e dimensões conferidos;
- bucket/key corretos;
- nenhuma dependência em conteúdo privado para superfície pública.

## Depois do upload

- objeto lido de volta;
- bytes/hash/MIME idênticos;
- colisão inexistente;
- evidência salva sem secrets.

## Antes de promover mídia pública

- GET HTTPS anônimo real;
- status/MIME esperados;
- decode concluído;
- hash/bytes conferidos;
- consumer/runtime aceita o host/path;
- fallback definido;
- rollback conhecido.

## Consumidores

- desktop e mobile revisados;
- crop/focal point não perde conteúdo importante;
- loading/erro não escondem informação principal;
- compartilhamento emite imagem da própria página quando elegível;
- nenhum consumidor reconstrói object key em paralelo.

## Retirada

- nenhuma referência/fallback ativa;
- fora da janela de rollback;
- não é master/evidência necessária;
- retenção cumprida;
- delete explicitamente autorizado.
