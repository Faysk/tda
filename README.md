# TDA — Tem Dado Aqui
Base do reboot: uma aplicação para histórias, sessões e o futuro Edit integrado.

- [Documentação e roadmap](docs/README.md)
- [Arquitetura](docs/architecture.md)
- [Infraestrutura e estado](docs/infrastructure.md)
- [Publicação controlada](docs/releases.md)

Node indicado em .node-version, pnpm fixado no package.json. Instalar com `pnpm install --frozen-lockfile`; verificar com `pnpm check`, `pnpm build` e `pnpm test:e2e`. Executar `pnpm dev`.

Copiar .env.example para .env.local. Sem credenciais, o site mostra um estado de preparação; não inventa sessões. Leitura real é explícita e somente de sessões publicadas. Não existe deployment automático.
