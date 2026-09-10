# ADR-0002 — Runtime PostgreSQL, papéis e contexto RLS

**Data:** 2026-09-10  
**Estado:** Aceito

## Contexto

O ENS deixará de usar Supabase como plataforma de dados. Precisamos definir o
runtime do PostgreSQL, a separação de privilégios e a forma de propagar o contexto
de identidade e tenant sem permitir acesso direto do navegador ao banco.

## Opções consideradas

1. PostgreSQL oficial com migrations próprias e RLS orientada por contexto
   transacional da App API.
2. Migração imediata e integral do schema legado antes de criar a fundação.
3. Reexecução das migrations Supabase ou Supabase auto-hospedado.

## Decisão

Adotar PostgreSQL oficial 18.6 em container, fixado por versão e digest testado.
Docker Desktop é o ambiente de desenvolvimento e Docker Compose em rede privada é
o runtime de produção na VPS.

O banco separa quatro capacidades: bootstrap, owner sem login, migrator e app. O
papel da aplicação nunca possui objetos, é `NOBYPASSRLS` e recebe somente os
grants mínimos. Migrations são imutáveis, verificadas por checksum, serializadas
por advisory lock e executadas por job separado.

A App API autentica o usuário, resolve membership e instala `app.user_id`,
`app.tenant_id`, `app.session_id`, `app.role` e `app.correlation_id` com escopo da
transação. Tabelas tenant-scoped usam `ENABLE ROW LEVEL SECURITY` e
`FORCE ROW LEVEL SECURITY`, com negação na ausência de contexto e `WITH CHECK`
para mutações.

O primeiro lote implementa apenas a fundação e um canário vertical. IAM completo,
RunStore e domínios de produto entram em lotes posteriores. PgBouncer só será
adicionado após medição e testes de compatibilidade com contexto transacional.

## Consequências

### Positivas

- a fronteira de segurança é testada antes da migração dos domínios;
- o runtime não depende de componentes Supabase;
- o mesmo contrato é reproduzível em Windows e Linux;
- conexão, ownership e RLS têm responsabilidades separadas;
- a aplicação pode evoluir por fatias sem expor PostgreSQL ao navegador.

### Custos e riscos

- funções, triggers e policies legadas precisam ser traduzidas e inventariadas;
- RLS continua sendo defesa em profundidade, não substituto de autenticação;
- operação própria exige backup, restore, atualização e observabilidade;
- erros no contexto transacional podem negar operações ou, se policies forem mal
  escritas, quebrar isolamento; por isso o teste de reuso do pool é obrigatório.

## Regras de revisão

Esta decisão deve ser revista se:

- o orçamento de conexões exigir pooler externo;
- PostgreSQL sair do mesmo host/rede privada dos consumidores;
- uma extensão obrigatória impedir uso da imagem oficial;
- requisitos de disponibilidade exigirem replicação ou serviço gerenciado;
- o modelo de tenant deixar de ser compartilhado por linhas.

Qualquer revisão deve preservar a proibição de acesso direto do navegador e
exigir evidência equivalente de menor privilégio e isolamento.

## Referências

- [desenho detalhado](../plans/2026-09-10-postgresql-foundation-design.md)
- [arquitetura-alvo](../architecture/target-architecture.md)
- [roadmap M3](../migration/roadmap.md)

