# Orientações para agentes

Este é o novo monorepo ENS. O repositório anterior é apenas fonte histórica durante a migração.

## Fronteiras obrigatórias

- Não vendorize nem modifique o core do Hermes Agent.
- Personalizações Hermes pertencem a `agents/ens` como SOUL, skills, plugins, configuração e MCPs.
- Não introduza Supabase, Graph MCP ou Neo4j na arquitetura nova.
- O navegador deve conversar com uma App API/BFF; nunca com PostgreSQL ou Hermes diretamente.
- Hermes permanece em rede interna e é acessado pelo Chat Bridge.
- PostgreSQL é a autoridade dos dados do produto; arquivos pertencem ao Artifact Server/object storage.
- Identidade, tenant e autorização de negócio são resolvidos pela aplicação, não pelo modelo.
- Nunca versione `.env`, credenciais, `auth.json`, sessões, memórias ou bancos do Hermes.

## Estado da migração

O código inicial foi copiado sem reescrever integrações. Referências legadas são esperadas até que a fase correspondente seja implementada. Não trate o código copiado como arquitetura final.

Leia `docs/plans/2026-08-27-initial-monorepo-migration-design.md` antes de alterar fronteiras arquiteturais.
