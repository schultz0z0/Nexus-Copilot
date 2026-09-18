# Service Level Objectives (SLOs) and Retention Policies

**Data da última revisão:** 2026-09-18
**Escopo:** Toda a plataforma ENS (App API, Artifact Server, Chat Bridge, Hermes Agent, PostgreSQL).

Este documento formaliza as métricas de tempo de atividade (Uptime), políticas de retenção de dados e limites operacionais toleráveis da plataforma ENS.

## 1. Objetivos de Recuperação de Desastre (Disaster Recovery)

Os seguintes limites são a base das operações de backup e restore:

*   **RPO (Recovery Point Objective): 1 hora.**
    *   *Definição:* Em caso de perda catastrófica do banco de dados principal, a perda máxima aceitável de histórico de conversas e transações do Marketing Ops é de 1 hora de dados.
    *   *Mecanismo:* O `restic` está configurado para realizar snapshots criptografados do volume do PostgreSQL, juntamente com WAL logs a cada hora.
*   **RTO (Recovery Time Objective): 2 horas.**
    *   *Definição:* O tempo máximo aceitável para restaurar a operação da plataforma após uma falha total da VPS ou do PostgreSQL.
    *   *Mecanismo:* O `restic` realiza o restore para novos volumes Docker. Testes documentados provam que uma reconstrução a partir do backup via rede gigabit da VPS conclui bem dentro da margem de 2h.

## 2. Service Level Objectives (SLOs)

Sendo uma aplicação voltada para uso interno e semi-síncrono (copiloto operado por humanos), a disponibilidade visa confiabilidade contínua sem exigir plantão 24/7 de baixa latência:

*   **Disponibilidade da App API e Frontend:** 99.5% em horário comercial.
*   **Disponibilidade da API do Hermes (Inferência):** 99.0% (depende também da estabilidade do *Provider* LLM upstream configurado).
*   **Tempo de Resposta do BFF (App API):** 95% das chamadas HTTP (excluindo inferência do Hermes e streaming) devem retornar em < 500ms.

## 3. Políticas de Retenção (Retention)

As seguintes políticas evitam o crescimento irrestrito do disco da VPS:

*   **Backups do PostgreSQL (Restic):**
    *   Retenção de todas as horas das últimas 48 horas.
    *   1 snapshot por dia nos últimos 30 dias.
    *   1 snapshot por semana por tempo indeterminado.
*   **Logs da Aplicação (Docker JSON logs):**
    *   Tamanho máximo por container de `100m` (100 Megabytes) com máximo de 3 arquivos no log rotation (configurado nos `compose.yaml`).
*   **Artifact Server (Anexos e Avatares):**
    *   Retenção permanente até exclusão deliberada pelo usuário. Os dados não expiram do volume local `ens-app-artifacts`.
*   **Histórico do Hermes (`ens-hermes-data`):**
    *   Os logs locais do próprio agente e memórias persistentes são mantidos indefinidamente, seguindo as diretrizes oficiais do runtime.

## 4. Alertas Críticos

Para manter os SLOs estabelecidos, os seguintes cenários devem acionar investigação ativa por parte do operador da VPS:

1.  **Espaço em Disco:** Alerta se `rootfs` ou partições do Docker ultrapassarem 85% de uso (evita corrupção de WAL/logs).
2.  **Container Down:** Alerta se `postgres`, `app-api` ou `chat-bridge` estiverem no estado `Exited` por mais de 1 minuto consecutivo.
3.  **Liveness do Hermes:** Alerta se o healthcheck do endpoint `:8642` retornar erro ou o container alternar para estado `unhealthy`.
4.  **Taxa de Erro HTTP 5xx:** Alerta se as respostas 5xx do Nginx/Traefik na porta 8080 ultrapassarem 5% no intervalo de 10 minutos.

Esses alertas devem ser monitorados pelo operador através do painel de infraestrutura da VPS ou por ferramentas como *Uptime Kuma* implementadas de maneira independente à stack.
