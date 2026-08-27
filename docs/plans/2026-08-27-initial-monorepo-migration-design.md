# Desenho do corte inicial do monorepo ENS

## Objetivo

Criar um repositório novo e limpo que preserve o frontend e os serviços de domínio prioritários, enquanto redefine a fronteira do Hermes como dependência oficial extensível por uma Profile Distribution ENS.

## Decisão arquitetural

O core Hermes não faz parte do monorepo. Desenvolvimento e produção usam versões oficiais controladas. O monorepo contém `agents/ens`, que é a fonte de verdade para SOUL, skills, configuração declarativa e conexões MCP distribuíveis.

O estado local do Hermes não é código-fonte. Memórias, sessões, credenciais, logs e bancos permanecem no `HERMES_HOME` de cada ambiente e nunca entram no Git.

## Escopo do primeiro corte

São copiados:

- frontend React/Vite, incluindo testes e configuração de build;
- serviço Marketing Ops, incluindo contratos HTTP/MCP e testes;
- Chat Bridge, incluindo adaptadores e testes existentes;
- Artifact Server e seus testes;
- SOUL atual do Hermes Desktop, depois de uma verificação de ausência de padrões de segredo;
- skills próprias ENS que hoje estão fora das fronteiras corretas do upstream.

Não são copiados:

- core Hermes vendorizado;
- runtime do Hermes Desktop;
- `.env`, `auth.json`, bancos, memórias ou sessões;
- árvore Supabase, Edge Functions e migrations antigas;
- Graph MCP, Neo4j, RAG MCP e Picture service;
- builds, dependências instaladas, caches e artefatos temporários.

## Fluxo alvo

```text
Browser -> App API/BFF -> PostgreSQL / Artifact Server
                     -> Chat Bridge -> Hermes oficial
                                         -> Profile ENS
                                         -> MCPs internos
```

O primeiro corte ainda não implementa a App API/BFF nem substitui as chamadas Supabase existentes. Ele estabelece uma baseline auditável para que essas mudanças sejam feitas por fatias verticais, com testes e commits separados.

## Dados e segurança

- Nenhuma credencial é copiada.
- O browser nunca receberá a chave do API Server do Hermes.
- A autorização de negócio não será inferida pelo modelo.
- PostgreSQL será reconstruído a partir de uma baseline vanilla, não da execução sequencial das migrations Supabase.
- O Artifact Server continuará como fronteira de binários; metadados migrarão para PostgreSQL.

## Critérios de aceite

1. O destino é um repositório Git independente.
2. Os quatro componentes selecionados estão presentes sem `node_modules` ou builds.
3. A árvore ativa não contém infraestrutura Supabase, Graph ou Neo4j.
4. `agents/ens` é uma distribuição válida e não contém estado local.
5. As dependências podem ser instaladas a partir dos lockfiles copiados.
6. Testes, typechecks e builds são executados e seu resultado real é registrado.
