# Operações e runbooks

Este diretório guardará procedimentos executáveis da plataforma. Um runbook só
é considerado aceito depois de ser exercitado em ambiente seguro e registrar a
data, o resultado e as premissas usadas.

## Runbooks exigidos

| Runbook | Marco | Estado |
| --- | --- | --- |
| [Hermes local no Windows](hermes-local-development.md) | M1 | Implementado; exercício pendente |
| [Paridade Hermes no Docker Desktop](hermes-docker-desktop-parity.md) | M1 | Exercitado com sucesso em 2026-09-09 |
| [Primeiro deploy Hermes na VPS](hermes-first-deploy.md) | M1 | Implementado; exercício pendente |
| Configuração manual de provider e OAuth | M1 | Incluído no primeiro deploy; exercício pendente |
| [Atualização e rollback do Hermes/profile](hermes-update-rollback.md) | M1 | Profile exercitado localmente em 2026-09-09; core/VPS pendentes |
| [Backup e restore do volume Hermes](hermes-backup-restore.md) | M1 | Exercitado localmente em 2026-09-09; VPS pendente |
| [Hermes Runs Bridge](hermes-runs-bridge.md) | M2 | Contrato sem provider exercitado localmente em 2026-09-09; provider/VPS pendentes |
| [Fundação PostgreSQL](postgresql-foundation.md) | M3 | Runtime, migrations e RLS exercitados localmente em 2026-09-10; produção bloqueada pelos gates restantes |
| [Backup e restore do PostgreSQL](postgresql-backup-restore.md) | M3 | Backup, retenção, fail-closed e restore drill exercitados localmente em 2026-09-11; VPS pendente |
| [Observabilidade operacional PostgreSQL](postgresql-observability.md) | M3 | Avaliação de RPO/RTO e contrato JSON sanitizado exercitados localmente em 2026-09-11; VPS pendente |
| Incidente de Auth/sessão | M4 | Pendente |
| Backup e restore de artefatos | M5 | Pendente |
| Ensaio e cutover de dados | M6 | Pendente |
| Retirada do dashboard Hermes público | M7 | Pendente |

## Situação do gate M1

Em 2026-09-09, o runbook de paridade Docker Desktop foi exercitado com sucesso
no escopo isolado autorizado. Init/update, runtime único do profile `ens`,
health/capabilities, restart, recriação e persistência foram comprovados. O
volume de evidência foi preservado e os containers foram removidos ao final.
Backup/restore e update/rollback do Profile ENS também foram exercitados em um
volume restaurado separado, com checksum e smoke autenticado. Rollback do core,
deploy e HTTPS/OAuth real na VPS continuam pendentes. A
classificação por critério está na
[matriz de aceite M1](../plans/2026-08-28-hermes-official-runtime-implementation.md#matriz-de-aceite-em-2026-09-09).

## Modelo operacional da VPS

Produção é sempre executada pelo operador humano. O agente prepara comandos
numerados, explica impacto e resultados esperados, recebe somente saídas/logs
redigidos e valida o gate antes de orientar a etapa seguinte. O agente não abre
SSH nem painéis administrativos. Uma URL pública pode ser testada apenas quando
o operador a fornecer explicitamente; isso não amplia o acesso à VPS.

## Estrutura mínima de um runbook

1. objetivo e impacto;
2. pré-requisitos e permissões;
3. variáveis necessárias, sem valores secretos;
4. checagens prévias e backup;
5. passos numerados e comandos seguros;
6. resultado esperado a cada passo;
7. verificação funcional;
8. rollback;
9. evidências e data do último exercício.

Comandos destrutivos devem identificar alvos absolutos, validar o alvo antes da
ação e oferecer caminho de recuperação quando possível.

