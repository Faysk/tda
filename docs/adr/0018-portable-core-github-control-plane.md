# ADR-0018 — Core portátil, GitHub como control plane e providers substituíveis

> Status: accepted
> Data: 2026-09-20
> Owner: arquitetura / operations
> Fonte de verdade: esta decisão, os invariantes de arquitetura e os contratos específicos de cada integração

## Contexto

O TDA é um produto de longo prazo cujo valor está no domínio, no conteúdo, nos dados e nas experiências construídas sobre eles. Vercel, Supabase e Cloudflare R2 resolvem muito bem as necessidades atuais e, no estágio presente, permitem operar o projeto com custo zero ou dentro das franquias gratuitas adequadas ao uso observado.

Esses serviços, porém, são providers de infraestrutura. Nenhum deles deve se tornar a identidade arquitetural do TDA nem tornar uma futura migração desnecessariamente ampla.

O repositório `Faysk/tda` já é a fonte canônica do reboot e GitHub Actions já controla a entrega. Esta decisão generaliza esse princípio: o GitHub é o control plane do projeto para código, documentação, manifests, migrations, automação e credenciais operacionais de CI/CD sempre que tecnicamente possível.

## Decisão

O TDA adota o princípio **portable core, replaceable edges**.

As regras permanentes são:

1. **GitHub é o control plane canônico.** Código, documentação, ADRs, manifests, migrations, workflows e configuração declarativa pertencem ao repositório. GitHub Actions controla operações automatizadas de entrega e infraestrutura.
2. **Providers externos são substituíveis.** O TDA usa atualmente Vercel para runtime/deploy, Supabase como plataforma de dados e Cloudflare R2 como Media Storage. Esses nomes descrevem a implementação atual, não contratos permanentes do domínio.
3. **Toda mídia pertence ao Media Storage.** Imagens, backgrounds, portraits, mapas, social cards, áudio, vídeo, assets de marca e demais binários de mídia não têm o Git como storage canônico. O provider atual de Media Storage é Cloudflare R2. Se o provider mudar, a regra de manter mídia fora do repositório permanece.
4. **O domínio depende de contratos, não do provider.** Features não devem espalhar chamadas específicas de R2, Supabase ou Vercel quando um boundary pequeno e explícito resolve a integração. A abstração deve existir na fronteira necessária; não criar frameworks genéricos ou adapters hipotéticos sem uso real.
5. **PostgreSQL é o contrato principal de persistência relacional.** Supabase é o provider atual desse banco e de capacidades auxiliares. SQL/migrations versionadas no Git são a referência de evolução. Uso de capacidade específica do Supabase é permitido quando traz valor, mas deve ser identificado e isolado o suficiente para que o custo de migração seja conhecido.
6. **GitHub concentra credenciais operacionais sempre que possível.** Secrets usados por GitHub Actions para deploy, migrations, publicação de mídia ou administração ficam em GitHub Environments, não são versionados e não devem depender de outro provider para serem recuperados. Um runtime pode manter localmente apenas os secrets que precisa em execução; esses secrets continuam sendo configuração do provider atual e devem ser provisionáveis/recriáveis a partir do processo controlado pelo GitHub.
7. **Free-first é a política de custo.** Enquanto segurança, integridade, capacidade e experiência forem atendidas, escolher a opção gratuita adequada. Serviço ou tier pago só entra após necessidade comprovada, comparação de alternativas e decisão documentada. Esta ADR não introduz nenhum serviço pago.
8. **Mudança estrutural inclui documentação.** Alteração de provider, boundary, secret esperado, workflow, schema, migration, storage, lifecycle, publicação ou rollback só está completa quando o documento dono e, quando necessário, o ADR correspondente são atualizados na mesma PR.

## Providers atuais

O estado atual é:

| Capability | Contrato do TDA | Provider atual |
| --- | --- | --- |
| versionamento/control plane | Git + CI/CD declarativo | GitHub + GitHub Actions |
| runtime/deploy web | runtime web substituível | Vercel Hobby |
| dados relacionais | PostgreSQL + migrations versionadas | Supabase Free |
| Media Storage | blob/object storage com objetos imutáveis e verificação | Cloudflare R2 Standard |
| processamento pesado de transcrição | processamento local | TDA Companion |

A tabela é estado de implementação, não promessa de permanência dos providers.

## Media Storage

A decisão anterior de usar R2 é generalizada para um boundary de **Media Storage**.

O contrato permanente preserva as garantias já aprovadas:

- toda mídia é armazenada fora do Git como binário de storage;
- objetos publicados usam identidade imutável/content-addressed quando aplicável;
- manifests versionados registram SHA-256, MIME, bytes, role, provenance e destino lógico;
- publicação não sobrescreve silenciosamente conteúdo imutável;
- upload é seguido por read-back;
- mídia pública exige verificação de entrega pública antes de promoção;
- private, preview e public continuam separados por audience/ambiente;
- credenciais de storage nunca chegam ao browser;
- features declaram mídia; não criam uploaders ou secrets próprios por lore/projeto.

Cloudflare R2 é a implementação atual desse contrato. Uma migração futura para S3, Azure Blob, Backblaze ou outro object storage deve trocar o adapter/configuração do Media Storage e preservar o contrato acima.

Binários de mídia que ainda existam no Git por decisões anteriores são compatibilidade/dívida de migração. Não constituem precedente para nova mídia e devem convergir para Media Storage em trabalho deliberado, sem remoção destrutiva ou quebra de bootstrap.

## Dados e Supabase

ADR-0002 continua válido como decisão operacional de reutilizar o banco existente enquanto ele atende ao TDA. Esta ADR esclarece que **Supabase não é identidade permanente da arquitetura**.

A portabilidade não exige evitar recursos úteis do provider nem construir uma segunda implementação antecipadamente. Exige:

- manter migrations e contratos de dados versionados no Git;
- distinguir PostgreSQL/SQL de capacidades específicas do Supabase;
- evitar espalhar SDK/provider-specific APIs pelo domínio quando um repository/boundary existente é suficiente;
- documentar dependências específicas que aumentem custo de migração;
- migrar apenas quando houver motivo real, com plano e evidência.

## Runtime e Vercel

ADR-0012 e ADR-0015 continuam válidos: GitHub Actions controla a entrega e Production continua orientada a recuperação.

Vercel é o runtime/deployment provider atual. Configuração necessária ao processo de CI/CD não deve ser armazenada exclusivamente na Vercel quando GitHub Actions é quem executa a operação.

Runtime secrets são exceção legítima: se o processo da aplicação rodando na Vercel precisa de uma credencial, ela pode existir no Environment correspondente da Vercel. Isso não transforma a Vercel em control plane. A origem administrativa, o contrato e o procedimento de reprodução/rotação continuam documentados e controlados pelo GitHub.

## Secrets

Há dois boundaries distintos:

### Operação/CI

Exemplos: publicar Media Storage, aplicar migration, promover deployment.

Esses secrets pertencem preferencialmente ao GitHub Environment que executa a operação.

### Runtime

Exemplos: conexão server-side do aplicativo com banco ou assinatura de acesso temporário ao Media Storage.

Esses valores existem onde o processo roda e somente com o escopo necessário. Não devem ser usados como cofre indireto para uma GitHub Action.

Nunca copiar valor de secret para Git, documentação, issue, PR, log ou chat.

## Free-first

A ordem de decisão é:

1. usar o provider/tier gratuito atual enquanto cumpre os requisitos;
2. otimizar uso ou arquitetura quando um limite real aparecer;
3. comparar migração gratuita, self-host/alternativa e upgrade;
4. adotar custo recorrente somente quando a vantagem justificar a despesa e estiver documentada.

Não antecipar escala hipotética com serviços pagos, mas também não enfraquecer segurança, autorização, backup, integridade ou confiabilidade crítica apenas para preservar custo zero.

## Documentação como parte da implementação

Toda PR estrutural deve declarar impacto documental.

Uma mudança é incompleta quando o código passa a operar de um modo e a documentação vigente descreve outro.

No mínimo:

- provider/boundary -> arquitetura/ADR + integração dona;
- secrets/ambiente -> runbook administrativo/ambientes;
- workflow/release -> CI/CD e runbook de release;
- schema/migration -> documentação de dados;
- Media Storage/pipeline -> contrato de mídia e runbook;
- custo/tier -> documento de infraestrutura/custos correspondente.

Evidências datadas permanecem históricas e não devem ser reescritas para parecer estado atual.

## Consequências

### Positivas

- reduz lock-in sem construir infraestrutura hipotética;
- concentra governança no sistema que já versiona o projeto;
- torna Vercel, Supabase e R2 substituíveis de forma independente;
- mantém custo atual em zero enquanto os free tiers atenderem;
- diminui configuração manual esquecida em dashboards;
- transforma documentação em parte verificável da mudança.

### Custos aceitos

- alguns providers continuarão aparecendo em adapters e runbooks específicos;
- runtime secrets ainda precisam existir no runtime quando realmente utilizados;
- mídia histórica versionada no Git precisará convergir gradualmente;
- provider-specific features precisam ter dependência documentada;
- portabilidade é um guardrail, não uma promessa de migração instantânea.

## Relação com ADRs anteriores

- **ADR-0014 é superseded por esta ADR quanto à escolha permanente de R2.** Suas garantias de mídia imutável, integridade, read-back, separação de audience e publicação compartilhada são preservadas e passam a pertencer ao contrato provider-neutral de Media Storage.
- **ADR-0002 continua accepted** como decisão de usar o Supabase existente hoje; esta ADR apenas estabelece que o provider pode ser substituído futuramente.
- **ADR-0012 continua accepted**: GitHub Actions permanece o controlador da entrega.
- **ADR-0015 continua accepted**: simplicidade, gates proporcionais e recuperação permanecem princípios da esteira.

## Fora de escopo desta decisão

Esta ADR não:

- migra R2, Supabase ou Vercel;
- adiciona serviço pago;
- cria adapters para providers que não usamos;
- move imediatamente todos os binários históricos do Git;
- altera secrets remotos por si só;
- modifica Production.

Essas convergências serão implementadas em PRs próprias, sempre com documentação e evidência.
