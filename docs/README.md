# Documentação do ENS

Este diretório é a memória durável da migração do ENS. Decisões tomadas em uma
sessão devem ser registradas aqui antes de serem tratadas como parte da
arquitetura ou do escopo aprovado.

## Comece por aqui

Para retomar o trabalho em uma nova sessão, leia nesta ordem:

1. [PRD da migração da plataforma](prds/PRD-0001-migracao-plataforma-ens.md);
2. [arquitetura-alvo](architecture/target-architecture.md);
3. [roadmap e gates](migration/roadmap.md);
4. o plano ativo indicado na seção **Trabalho atual**;
5. os ADRs relacionados à fase em andamento.

O repositório anterior, `projeto-ens-unificado`, é apenas referência histórica.
Ele ajuda a investigar comportamentos existentes, mas não define a arquitetura
nova.

## Trabalho atual

| Item | Estado | Documento |
| --- | --- | --- |
| Fundação documental | Concluída | este índice, PRD, arquitetura e roadmap |
| Runtime Hermes oficial | Em execução; paridade Docker aprovada | [plano de implementação](plans/2026-08-28-hermes-official-runtime-implementation.md) e [evidência Docker Desktop](operations/hermes-docker-desktop-parity.md) |
| Hermes Runs Bridge | Em execução; checkpoint C local aprovado | [desenho](plans/2026-09-09-hermes-runs-bridge-design.md), [plano](plans/2026-09-09-hermes-runs-bridge-implementation.md) e [runbook](operations/hermes-runs-bridge.md) |
| Fundação PostgreSQL | Em execução; primeiro lote aprovado localmente | [desenho M3](plans/2026-09-10-postgresql-foundation-design.md), [plano e evidências](plans/2026-09-10-postgresql-foundation-implementation.md), [ADR-0002](decisions/ADR-0002-postgresql-runtime-roles-and-rls.md) e [runbook](operations/postgresql-foundation.md) |
| Migração de Supabase | Em execução; inventário inicial registrado | [desenho da migração](plans/2026-08-27-supabase-to-local-services-migration-design.md) e [inventário de capacidades](migration/supabase-capability-inventory.md) |
| Ledger DDL do Supabase | Desenho aceito; implementação pendente | [desenho do ledger](plans/2026-09-10-supabase-ddl-ledger-design.md) |
| Migração inicial do monorepo | Baseline concluída | [desenho](plans/2026-08-27-initial-monorepo-migration-design.md) e [plano](plans/2026-08-27-initial-monorepo-migration.md) |

O próximo gate externo do Hermes é configurar manualmente um provider e provar
run completo, approval, rejeição e cancelamento conforme o runbook M2. Em
paralelo, o próximo marco de implementação local é **M3 — fundação
PostgreSQL**.

## Mapa da documentação

- `prds/`: problema, usuários, resultados, escopo e critérios de aceite do produto;
- `architecture/`: arquitetura-alvo e contratos entre componentes;
- `decisions/`: ADRs imutáveis que explicam decisões arquiteturais;
- `migration/`: fases, dependências, gates e rastreabilidade da migração;
- `plans/`: desenhos e planos de implementação datados;
- `operations/`: runbooks operacionais, deploy, atualização, backup e recuperação.

## Estados dos documentos

Use apenas estes estados:

- **Rascunho**: ainda em discussão, não autoriza implementação;
- **Proposto**: pronto para revisão e aprovação;
- **Aceito**: decisão vigente e autorizada;
- **Em execução**: trabalho iniciado, critérios ainda não comprovados;
- **Concluído**: critérios de aceite verificados e evidências registradas;
- **Substituído**: mantido para histórico, com link para o sucessor.

Não marque um documento como concluído apenas porque arquivos foram criados. O
estado só muda após a verificação dos critérios de aceite correspondentes.

## Regras de fonte de verdade

Em caso de divergência, prevalece esta ordem:

1. restrições do `AGENTS.md`;
2. ADR aceito mais recente;
3. arquitetura-alvo;
4. PRD aceito;
5. roadmap;
6. plano de implementação da fase;
7. código legado e documentação histórica.

Segredos, `.env`, credenciais, `auth.json`, sessões, memórias e bancos do Hermes
nunca fazem parte desta documentação ou do Git.

## Protocolo de continuidade entre sessões

Ao encerrar uma sessão com trabalho incompleto:

1. atualize o estado da fase no roadmap;
2. marque no plano quais tarefas e testes foram concluídos;
3. registre decisões novas em um ADR ou na seção de decisões pendentes;
4. anote bloqueios, riscos e o próximo comando seguro a executar;
5. mantenha commits pequenos e referencie o hash quando ele for uma evidência;
6. não declare aceite sem guardar o comando executado e o resultado observado.

Ao retomar, confirme `git status`, leia o plano ativo e execute primeiro as
verificações deixadas pela sessão anterior. Não repita descoberta já registrada.

## Como propor mudanças

- Mudança de objetivo ou escopo de produto: atualizar o PRD.
- Mudança de fronteira, autoridade de dados ou tecnologia estrutural: novo ADR e
  atualização da arquitetura-alvo.
- Mudança apenas na sequência de execução: atualizar o roadmap ou o plano ativo.
- Descoberta operacional: atualizar ou criar um runbook.
- Dívida encontrada durante uma fase: registrar no plano e no roadmap; não a
  esconder como trabalho “implícito”.

