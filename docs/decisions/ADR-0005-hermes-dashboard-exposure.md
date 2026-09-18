# ADR-0005: Exposição e Acesso ao Dashboard do Hermes

**Status:** Proposto / Em vigor
**Data:** 2026-09-18

## Contexto

Durante o M1 (Runtime Hermes Oficial), o dashboard web fornecido pelo Hermes Agent foi exposto em `hermes.solucoes-nexus.tech` utilizando Traefik com terminação TLS (Let's Encrypt) e proteção via `Basic Auth`.
No PRD-0001, a permanência desse painel na internet constava como uma decisão pendente (retirar da internet ou possuir decisão explícita no M7).

Como a infraestrutura VPS precisa manter o plano de controle operável pelo mantenedor sem obrigatoriamente exigir uma VPN corporativa para acessar o Hermes, precisamos formalizar se a exposição com Basic Auth é suficiente a longo prazo ou se a rota pública deve ser extinta.

## Decisão

1. **Manutenção do domínio público:** O domínio `hermes.solucoes-nexus.tech` permanecerá acessível na internet.
2. **Proteção de borda:** O Traefik continuará exigindo `Basic Auth` antes de qualquer tráfego alcançar o contêiner do Hermes, mitigando vulnerabilidades em painéis não desenhados para a internet aberta.
3. **Isolamento da API REST:** A porta `8642` da API do Hermes **não** será exposta externamente sob nenhuma hipótese. O Traefik roteia apenas o frontend do dashboard (geralmente escutando na porta 8000 internamente ou conforme o build do Hermes).

## Consequências

- **Positivas:** Operadores conseguem administrar e debugar sessões do agente remotamente com facilidade.
- **Negativas:** Exposição a tentativas de brute-force no endpoint de HTTP Basic Auth.
- **Mitigação:** Recomendamos rotacionar a senha de Basic Auth periodicamente usando ferramentas como `htpasswd` e, se viável, adicionar regras de IP Whitelist ou Fail2Ban em configurações futuras de infraestrutura do sistema hospedeiro.
