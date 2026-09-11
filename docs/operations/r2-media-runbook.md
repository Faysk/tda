# R2 e mídia — runbook operacional

> Status: vigente
> Owner: integrations/media + operations
> Última revisão: 2026-09-11

Fluxo obrigatório: confirmar identidade/role/audience; validar provenance; calcular SHA-256, MIME, bytes e dimensões; escolher bucket/key; verificar colisão; fazer upload somente quando autorizado; executar read-back; para mídia pública, validar URL HTTPS anônima e decode; registrar evidência; só então promover referência e validar frontend/social.

Para as imagens históricas de sessão, o tooling existente é `tools/migrate-session-media-r2.mjs`. O modo padrão recupera/valida sem escrever no R2; `--verify-db --check-r2` faz verificações adicionais. Upload real exige autorização explícita e `--upload`.

Por objeto, registrar URL, HTTP status, Content-Type, bytes, SHA-256, decode e horário, sem credenciais ou dados privados.

Rollback preserva a referência anterior e aborta se houver edição concorrente. Upload aditivo não exige apagar o objeto para desfazer o consumo.
