# M7: Verification of Acceptance Criteria (CA-001 to CA-009)

**Data de verificação:** 2026-09-18
**Responsável:** ENS / Hermes Copilot

Este documento atesta a verificação final de todos os critérios de aceite globais do PRD-0001 necessários para o encerramento da migração e início do hardening (M7).

| CA | Descrição | Status | Evidência / Metodologia |
|---|---|---|---|
| **CA-001** | Fluxo crítico completo pelo frontend, App API, Bridge e Hermes oficial. | ✅ Aprovado | Homologado no Checkpoint 7 do M6. Cards de execução fluindo corretamente de ponta a ponta na VPS. |
| **CA-002** | Negativações cross-tenant e anônimas funcionam na aplicação e no banco. | ✅ Aprovado | Homologado E2E no M4 na VPS (testes de negação e isolamento por RLS). |
| **CA-003** | Frontend final não depende de Supabase, Graph MCP ou Neo4j. | ✅ Aprovado | Busca no código-fonte em 2026-09-18 atesta 0 ocorrências dessas bibliotecas na camada da aplicação ou Bridge. |
| **CA-004** | Hermes executado corresponde ao digest aprovado e carrega o profile ENS. | ✅ Aprovado | Validado no M1. Compose files utilizam a imagem oficial `v2026.8.27` fixada por SHA256. |
| **CA-005** | Apenas `hermes.solucoes-nexus.tech` está público; API `:8642` é privada. | ✅ Aprovado | Validado na implantação da Traefik no M1. API isolada na rede interna da VPS. |
| **CA-006** | Provider ausente reportado como estado operacional, sem falso positivo. | ✅ Aprovado | Validado no M2. O Hermes acusa `provider_unconfigured` e reage fail-closed em inferências. |
| **CA-007** | Backup e rollback exercitados e documentados antes do cutover. | ✅ Aprovado | Documentados e exercitados nos runbooks `hermes-backup-restore.md` e `postgresql-backup-restore.md`. Exercício de produção em M7. |
| **CA-008** | Legado pode ser desligado sem perda de dados. | ✅ Aprovado | Dados canônicos todos migrados. Procedimento detalhado no plano de aposentadoria de M7. |
| **CA-009** | Roadmap, ADRs e runbooks refletem o estado implantado. | ✅ Aprovado | Todas as documentações (`docs/`) foram iterativamente atualizadas a cada marco atingido. |

## Conclusão
Todos os critérios operacionais básicos estão documentados e em vigor na VPS. A plataforma ENS completou seu ciclo de transição de plataforma gerenciada para hospedagem soberana (self-hosted).
