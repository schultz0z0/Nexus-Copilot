# ADR-0001 — Core Hermes oficial e Profile Distribution ENS

**Estado:** Aceito  
**Data:** 2026-08-28  
**Decisores:** ENS

## Contexto

O projeto anterior vendorizava e alterava o Hermes. Isso dava controle imediato,
mas aumentava o custo de manutenção, dificultava atualizações upstream e fazia o
ambiente local divergir da produção. A arquitetura nova precisa manter a
personalização ENS sem assumir propriedade sobre o core.

## Opções consideradas

1. **Manter o fork vendorizado.** Preserva alterações existentes, mas perpetua o
   custo de merge, segurança e divergência.
2. **Instalar o Hermes por script em toda inicialização.** É simples, mas não fixa
   de forma suficiente o artefato de produção e mistura instalação com startup.
3. **Usar imagem oficial fixada e Profile Distribution ENS.** Mantém o core
   upstream, dá reprodutibilidade e usa os pontos de extensão suportados.

## Decisão

Adotar a opção 3:

- desenvolvimento usa a instalação local oficial já existente;
- produção usa `nousresearch/hermes-agent:v2026.8.27` fixada também pelo digest
  `sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79`;
- a aplicação corresponde à versão Hermes Agent `0.20.6` e ao commit upstream
  auditado `5fc308a70719a83cccdbba4c0e39c23f5a8239d5`;
- `agents/ens` é a única área de personalização do agente;
- um container one-shot instala ou atualiza o profile `ens` e termina;
- somente depois um container persistente inicia o runtime usando o mesmo volume;
- provider é configurado manualmente fora do Git;
- o Chat Bridge usa a API oficial de Runs/SSE/aprovação do Hermes;
- dashboard `hermes.solucoes-nexus.tech` fica público temporariamente, com TLS e
  Nous OAuth; a API `:8642` não recebe rota pública;
- atualização do core é manual, testada e feita pela alteração deliberada de
  versão/digest.

## Consequências positivas

- atualização e rollback tornam-se explícitos e reproduzíveis;
- personalizações podem ser testadas sem carregar um fork permanente;
- Windows local e Linux de produção usam o mesmo contrato de profile;
- o limite entre produto e runtime do agente fica auditável.

## Custos e limitações

- integrações antigas que dependem do fork precisam ser reescritas;
- funcionalidades upstream só entram após teste e mudança do pin;
- profile init e runtime não podem escrever simultaneamente no mesmo volume;
- o dashboard público temporário exige operação e revisão de segurança;
- o tag/commit upstream auditado não possui assinatura verificada; o digest reduz
  mutabilidade, mas não substitui proveniência criptográfica.

## Critérios de revisão

Reavaliar esta decisão se:

- o upstream abandonar Profile Distribution ou a API oficial usada pelo Bridge;
- surgir artefato oficial assinado com processo de proveniência superior;
- isolamento de tenants exigir múltiplos agentes em vez do agente único aprovado;
- o dashboard público for retirado, caso em que a parte de exposição será
  substituída por novo ADR operacional.

## Referências

- [desenho detalhado do runtime](../plans/2026-08-28-hermes-official-runtime-design.md)
- [arquitetura-alvo](../architecture/target-architecture.md)
- [repositório upstream](https://github.com/NousResearch/hermes-agent)
- [documentação oficial](https://hermes-agent.nousresearch.com/)

