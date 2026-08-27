# ENS — monorepo de migração

Este repositório é a nova base do produto ENS. Ele nasce a partir de um corte controlado do projeto `projeto-ens-unificado`, preservando o frontend e os serviços de domínio que ainda serão adaptados para a arquitetura final.

## Estado inicial

Incluído neste primeiro corte:

- `apps/chat-web`
- `services/marketing-ops`
- `services/chat-bridge`
- `services/artifact-server`
- `agents/ens`, como Profile Distribution do Hermes Agent oficial

Não incluído:

- fork ou cópia do core Hermes;
- Supabase migrations, Edge Functions ou configuração de projeto;
- Graph MCP e Neo4j;
- dados, sessões, memórias, credenciais ou arquivos `.env` locais;
- RAG MCP e Picture MCP, que serão migrados em fases próprias.

O código copiado ainda contém integrações legadas com Supabase e com o runtime Hermes anterior. Isso é dívida de migração conhecida, não a arquitetura desejada.

## Princípio do Hermes

O core é sempre o Hermes Agent oficial instalado pelo mecanismo oficial e fixado por versão no ambiente de produção. O comportamento ENS fica em `agents/ens`: SOUL, skills, configuração declarativa e MCPs.

Estado mutável permanece fora do Git e separado por ambiente:

- desenvolvimento: profile, banco, secrets, memórias e sessões locais;
- produção: profile, banco, secrets, memórias e sessões da VPS.

## Comandos de verificação

```powershell
npm run typecheck
npm test
npm run build
```

Cada script chama os comandos dos pacotes copiados. Consulte `docs/plans` para o desenho e a sequência de migração.

## Documentação arquitetural

- [Corte inicial do monorepo](docs/plans/2026-08-27-initial-monorepo-migration-design.md)
- [Migração do Supabase para serviços locais ENS](docs/plans/2026-08-27-supabase-to-local-services-migration-design.md)
