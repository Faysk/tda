# Contexto e limites do sistema

> Status: vigente
> Owner: arquitetura
> Última revisão: 2026-09-06

## Propósito do TDA

O TDA é a plataforma da campanha para navegar sessões e resumos, operar revisão/publicação, consolidar memória estruturada e futuramente explorar entidades, relações, timeline, mapas, músicas, quests e conhecimento por audiência.

O produto precisa continuar útil com o PC de processamento desligado. Processamento pesado de áudio/transcrição permanece local; conteúdo sincronizado e aprovado é consumido pela aplicação cloud.

## Atores

### Público
Pode consumir somente conteúdo explicitamente publicado para web. Não deve receber transcrições, dados de conta, metadata interna, notas privadas ou objetos de revisão.

### Player autenticado
Pode consumir conteúdo autorizado da campanha e, futuramente, editar/consultar superfícies permitidas por capabilities. Não deve receber segredos de mestre ou dados técnicos desnecessários.

### DM / owner / operadores autorizados
Podem revisar candidatos, gerenciar conteúdo, aprovar canon/publicação e operar superfícies administrativas conforme capabilities.

### Companion local
Agente técnico autorizado a sincronizar metadados/resultados derivados, sem transformar automaticamente conteúdo em canon.

### Serviços externos
Supabase, Cloudflare R2, Vercel, Craig/Discord, Roll20 e provedores de IA/transcrição entram através de integrações explícitas.

## Dentro do boundary do produto

- site público;
- autenticação e identidade do produto;
- Edit/review board integrado;
- navegação de sessões/resumos;
- entidades e memória estruturada;
- publicação e regras de visibilidade;
- metadados de processamento;
- integração autenticada com companion;
- referências a mídia e objetos R2;
- auditoria e autorização do domínio.

## Fora do boundary cloud

- processamento pesado contínuo de áudio;
- retenção cloud de áudio bruto como requisito do reboot;
- um segundo frontend público legado;
- execução local do Roll20/Craig;
- armazenamento de secrets administrativos no browser.

## Dependências externas

### Supabase
Banco PostgreSQL, Auth, RLS, funções/RPCs e contratos de dados. É a única base canônica do reboot.

### Cloudflare R2
Armazenamento de binários, separado por visibilidade/ambiente. Não substitui metadados relacionais.

### Vercel
Hospedagem futura do frontend/app. Deploy é controlado e não automático.

### Craig / Discord
Fontes de gravação, identidade operacional, notas/interações e contexto de sessão.

### Roll20
Fonte opcional de eventos/marcadores de mesa. Evento importado é evidência, não canon.

### Provedores de IA
Produzem transcrição, classificação, sumarização ou outras derivações. Resultado de IA é rastreável por modelo/prompt/run quando disponível e não ganha autoridade canônica sozinho.

## Restrições arquiteturais

- custo deve permanecer previsível; evitar serviços cloud pesados sem necessidade;
- dado narrativo privado não pode vazar por conveniência de frontend;
- produção não é resetável para facilitar desenvolvimento;
- legado continua compatível até independência comprovada;
- schema deve evoluir por migrations pequenas e auditáveis;
- features futuras não devem ser escondidas em `metadata` se merecem relações/estado próprios;
- a aplicação pública deve selecionar apenas campos necessários.

## Identidades fixas

- projeto: `tda`;
- campanha principal: `yuhara-main`;
- Supabase: `dmrqnbdvbkfqzctcerbx`;
- repositório atual: `Faysk/tda`;
- legado: `Faysk/dnd-scribe`.

## Critério de boundary saudável

Uma feature está no lugar correto quando:

1. regra de negócio vive em domínio/feature, não na integração;
2. integração externa pode ser substituída sem redefinir identidade narrativa;
3. autorização acontece antes de dados sensíveis chegarem ao browser;
4. processamento pode falhar/repetir sem promover conteúdo indevidamente;
5. o sistema cloud continua servindo conteúdo sincronizado com companion desligado.
