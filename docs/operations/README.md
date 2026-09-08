# Operações e runbooks

Este diretório guardará procedimentos executáveis da plataforma. Um runbook só
é considerado aceito depois de ser exercitado em ambiente seguro e registrar a
data, o resultado e as premissas usadas.

## Runbooks exigidos

| Runbook | Marco | Estado |
| --- | --- | --- |
| [Hermes local no Windows](hermes-local-development.md) | M1 | Implementado; exercício pendente |
| [Primeiro deploy Hermes na VPS](hermes-first-deploy.md) | M1 | Implementado; exercício pendente |
| Configuração manual de provider e OAuth | M1 | Incluído no primeiro deploy; exercício pendente |
| [Atualização e rollback do Hermes/profile](hermes-update-rollback.md) | M1 | Implementado; ensaio pendente |
| [Backup e restore do volume Hermes](hermes-backup-restore.md) | M1 | Implementado; ensaio pendente |
| Backup e restore do PostgreSQL | M3 | Pendente |
| Incidente de Auth/sessão | M4 | Pendente |
| Backup e restore de artefatos | M5 | Pendente |
| Ensaio e cutover de dados | M6 | Pendente |
| Retirada do dashboard Hermes público | M7 | Pendente |

## Situação do gate M1

Em 2026-09-08, os runbooks M1 foram implementados, mas nenhum foi marcado como
exercitado. O computador corporativo não recebeu pull de imagem, container ou
volume de teste sem autorização específica. A implementação está pronta para
ensaio; persistência, backup/restore, rollback e HTTPS/OAuth real continuam
pendentes. A classificação por critério está na
[matriz de aceite M1](../plans/2026-08-28-hermes-official-runtime-implementation.md#matriz-de-aceite-em-2026-09-08).

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

