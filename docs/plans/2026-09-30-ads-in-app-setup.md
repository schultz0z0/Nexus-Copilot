# Ads In-App Setup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Administrador prepara ou troca aplicativos Ads pelo Prometeus, sem editar arquivos; gestores autorizam e trocam contas pelo fluxo existente.

**Architecture:** BFF mantém sessão e assinatura; Marketing Ops valida a autoridade canônica e gerencia configuração privada persistente da instalação. Clientes OAuth passam a acompanhar a configuração em execução; mudanças invalidam estados, tokens e jobs anteriores, preservando histórico.

**Tech Stack:** React, componentes/tokens existentes, Express/Fastify, PostgreSQL, Node filesystem privado e Docker Compose; nenhuma dependência nova.

---

O desenho aprovado está em `2026-09-30-ads-in-app-setup-design.md`. Trabalhar no
checkout atual `codex/campaign-lead-ingestion`, preservando mudanças anteriores;
não criar commits, PR, checkout ou deploy de produção nesta avaliação local.

## Task 1: Configuração privada e ciclo de troca no servidor

**Files:**
- Create: `services/marketing-ops/src/integrations/ads/setupStore.ts` e teste correspondente.
- Modify: `services/marketing-ops/src/domain/ads.ts`, `src/integrations/ads/types.ts`, `config.ts`, `src/index.ts`, `src/http/routes/ads.ts`.
- Test: `services/marketing-ops/src/ads.integration.test.ts`, `src/http/routes/ads.test.ts`.
- Modify: `services/marketing-ops/Dockerfile`, `infra/app/compose.yaml`, `compose.development.yaml`, `compose.production.yaml`.

1. Escrever regressões: instalação vazia retorna metadados de preparo; usuário
   member/manager não cadastra segredo; admin canônico pode salvar; primeiro
   preparo vincula configuração à instalação/tenant; leitura não devolve segredo.
2. Implementar volume privado persistente, chave forte criada automaticamente
   quando não há chave operacional existente, gravação atômica e restrita,
   limites/validação de entrada e reinício que conserva configuração.
3. Manter configuração externa existente. Assumir gestão pelo app exige confirmação
   explícita; não modificar arquivos operacionais readonly silenciosamente.
4. GET `/v1/ads-integrations/:provider/setup`: metadados administrativos, versão
   positiva inicial 1, origem/retorno confiáveis, client ID, flags de segredo e
   campos específicos. Nunca devolver segredo/chave/token.
5. POST no mesmo caminho: If-Match e Idempotency-Key, campos específicos,
   segredo opcional somente quando já existe; preservá-lo quando vazio. Troca
   precisa de confirmação explícita do impacto. Replays não repetem a troca.
6. Integrar publicação dos clientes em execução e invalidação de estados OAuth,
   tokens e jobs do aplicativo anterior. Impedir autorização durante uma troca;
   callbacks/leituras em andamento nunca podem publicar na configuração nova.
   Falha de persistência conserva a configuração anterior ou bloqueia de forma
   explícita, sem misturar credenciais/tokens. Histórico permanece intacto.
7. Iniciar a rotina periódica mesmo se nenhum provedor estava preparado no boot,
   para que o primeiro cadastro pelo app habilite as leituras posteriores.
8. Tests: `rtk proxy npm test -- --pool=forks --maxWorkers=1` em Marketing Ops com
   banco isolado; unit do store antes da integração; `rtk proxy npm run typecheck`.
   Se schema adicional for indispensável, criar 0021; não modificar 0020 aplicada.

## Task 2: Assistente administrativo e troca na interface

**Files:**
- Modify: `apps/chat-web/src/lib/marketingOps/ads.ts`, `ads.test.ts`.
- Modify: `apps/chat-web/src/components/marketing-ops/AdsIntegrations.tsx`, `AdsIntegrations.test.tsx`.
- Create: `apps/chat-web/src/components/marketing-ops/AdsSetupDialog.tsx` (se necessário).
- Modify: `apps/chat-web/src/pages/settings/IntegrationsPage.tsx`, `e2e/ads-integrations.spec.ts`, `DESIGN.md`.

1. Depois de Task 1 + revisão SPEC e qualidade aprovadas, consolidar DTO exato.
2. Admin vê Configurar aplicativo quando vazio e Editar/Trocar aplicativo quando
   existente. Gestor segue autorizado a conectar/trocar conta, sem acesso ao segredo.
3. Assistente mostra Aplicativo → Autorização → Conta, campos específicos, retorno
   copiável, campos avançados recolhidos e links oficiais de preparo. Campo segredo
   fica vazio após leitura; mostrar apenas cadastrado/não cadastrado.
4. Revisar antes de salvar/trocar. Explicar nova autorização e histórico preservado;
   preservar valores locais após erro, sem localStorage/URL/console/analytics.
5. Salvar revela Continuar e autorizar. Só a ação humana inicia OAuth; salvar não
   declara conexão ativa. Reusar seleção/troca de conta e conexões existentes.
6. Testar admin desde instalação vazia, manager/member, validação, cancelamento,
   conflito de versão, retry, segredo preservado, troca + nova autorização, foco,
   teclado, 44 px, responsividade e ausência de segredos em DTO/navegação.
7. Gate: `rtk proxy npm exec vitest run -- --pool=threads --maxWorkers=1`,
   `rtk proxy npm exec tsc -- --noEmit -p tsconfig.app.json`, lint e sete fluxos E2E
   existentes ampliados para preparo/troca; novos testes quando necessário.

## Task 3: Contratos, documentação e revisão integrada

**Files:**
- Modify: `services/marketing-ops/openapi/marketing-ops.v1.yaml` e testes de paridade.
- Test: `services/app-api/test/marketing.test.js` para proxy seguro dos novos endpoints.
- Modify: `AGENTS.md`, `docs/integrations/ads-white-label.md`, `ads-installation.md`,
  `docs/testing/manual-validacao-local.md`.

1. Documentar cadastro pelo app, arquivos/volume privados e backup da chave;
   papéis, gerenciamento externo e troca sem apagar histórico.
2. Manter BFF genérico com headers confiáveis e sem logging de corpo/segredos;
   verificar proxy do novo setup e ausência de header de sessão forjado.
3. Realizar SPEC e qualidade por tarefa, depois revisão integrada final.

## Task 4: Avaliação local completa

1. Executar gates independentes finais, migrations/replay quando houver, build.
2. Atualizar somente os serviços afetados no Docker localhost, preservando os
   segredos/sessões existentes e os containers de outros projetos.
3. Validar instalação sem aplicativos reais: botão de preparo visível para admin,
   formulário, retorno confiável, autorização dos papéis, layout e serviços saudáveis.
4. Em ambiente isolado e com HTTP do provedor simulado, validar save → authorize →
   conta → vínculo/sync → troca → estado antigo recusado; reiniciar e reler config.
   Não gravar aplicativos fictícios como integrações prontas no banco de avaliação.
5. Atualizar manual e evidência. Aplicativos/contas reais continuam necessários
   para validar consentimento e acesso externo; não simular sucesso na UI real.

## Checklist

- [x] Task 1 implementada, testada, SPEC e qualidade aprovadas.
- [x] Task 2 implementada, testada, SPEC e qualidade aprovadas.
- [x] Task 3 contratos/documentação e revisão integrada aprovados.
- [x] Task 4 build e avaliação local concluídos.
