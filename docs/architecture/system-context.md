# Contexto e limites do sistema

> Status: vigente
> Owner: arquitetura
> Última revisão: 2026-09-20
> Fonte de verdade: ADR-0018 + invariantes de arquitetura

## Propósito do TDA

O TDA é a plataforma da campanha para navegar sessões e resumos, operar revisão/publicação, consolidar memória estruturada e explorar entidades, relações, timeline, mapas, músicas, quests e conhecimento por audiência.

O produto deve continuar útil com o PC de processamento desligado. Processamento pesado de áudio/transcrição permanece local; conteúdo sincronizado e aprovado é consumido pela aplicação cloud.

## Princípio estrutural

O TDA segue **portable core, replaceable edges**.

GitHub é o control plane. Providers externos entram por integrações explícitas e podem ser substituídos sem redefinir identidade narrativa ou regras do domínio.

Providers atuais:

- runtime/deploy: Vercel;
- dados relacionais/Auth: Supabase sobre PostgreSQL;
- Media Storage: Cloudflare R2.

## Atores

### Público
Consome somente conteúdo explicitamente publicado para web.

### Player autenticado
Consome conteúdo autorizado e usa superfícies permitidas por capabilities.

### DM / owner / operadores autorizados
Revisam candidatos, gerenciam conteúdo, aprovam canon/publicação e operam superfícies administrativas conforme capabilities.

### Companion local
Sincroniza resultados/metadados e executa processamento pesado sem transformar resultado automaticamente em canon.

### Serviços externos
Providers atuais e fontes externas entram por `src/integrations` ou boundary equivalente; nenhum fornecedor redefine o modelo de domínio.

## Dentro do boundary do produto

- site público;
- autenticação e identidade;
- Edit/review;
- sessões/resumos;
- entities e memória estruturada;
- publicação e visibilidade;
- metadados de processamento;
- integração autenticada com Companion;
- referências de Media Storage;
- auditoria e autorização.

## Fora do boundary cloud

- processamento pesado contínuo de áudio;
- retenção cloud obrigatória de áudio bruto;
- segundo frontend público legado;
- execução local de Roll20/Craig;
- secrets administrativos no browser.

## Dependências externas atuais

### PostgreSQL / Supabase

PostgreSQL é o contrato relacional principal. Supabase é o provider atual de banco/Auth/RLS/RPCs.

### Media Storage / Cloudflare R2

Media Storage guarda binários persistidos/publicados. R2 é o provider atual e não substitui metadados relacionais.

### Runtime / Vercel

Vercel é o provider atual de hosting/runtime. Deploy é controlado pelo GitHub Actions.

### Craig / Discord / Roll20

Fontes externas de gravação, identidade operacional, notas/interações e eventos de mesa. Evento importado é evidência, não canon.

### Provedores de IA

Produzem derivações. Resultado de IA permanece rastreável e não ganha autoridade canônica sozinho.

## Restrições arquiteturais

- GitHub é o control plane canônico;
- providers são substituíveis;
- infraestrutura é free-first enquanto atende requisitos;
- dado privado não vaza por conveniência;
- Production não é resetável por conveniência;
- schema evolui por migrations pequenas/auditáveis;
- Media Storage mantém bytes; banco mantém domínio;
- UI pública seleciona apenas campos necessários;
- mudança estrutural exige documentação na mesma PR.

## Identidades

- produto: `tda`;
- campanha principal: `yuhara-main`;
- repositório: `Faysk/tda`;
- legado: `Faysk/dnd-scribe`;
- provider atual de DB: Supabase `dmrqnbdvbkfqzctcerbx`.

Provider ID é configuração/provenance, não identidade do produto.

## Boundary saudável

Uma feature está no lugar correto quando:

1. regra de negócio vive em domínio/feature;
2. provider pode mudar sem redefinir identidade do domínio;
3. autorização ocorre antes de dados sensíveis chegarem ao browser;
4. processamento pode falhar/repetir sem promover conteúdo indevido;
5. conteúdo sincronizado continua disponível com Companion desligado;
6. mudança de infraestrutura é localizada no edge e documentada.
