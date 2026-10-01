# Identidade Prometeus no sistema

## Direção e escopo

Aplicar a identidade de https://agenciaprometeus.com.br/ ao aplicativo existente,
preservando layouts, navegação, permissões, dados e integrações. Nome escolhido
pelo usuário: **Prometeus**. Fonte complementar: manual em `docs/brandbook`,
ignorando sua primeira página, conforme solicitado.

O site foi inspecionado em 26/09/2026: Space Grotesk nos textos, Geist Mono em
detalhes técnicos, fundos escuros, azul nos controles e bordas sutis. O manual
define Outfit para o logotipo; os PNGs fornecidos preservam essa assinatura.

Paleta oficial: #040814, #0652C5, #FFFFFF, #1A2338, #3B4B6B, #E2E8F0.
Tons derivados são permitidos para contraste acessível e estados interativos.
Reutilizar logos originais e substituir os nomes ENS/Nexus nas superfícies
visíveis. Por ajuste explícito do usuário, manter o robô original e suas duas
caixinhas de diálogo, com superfícies adaptadas à Prometeus. Identificadores
técnicos legados e conteúdo histórico não são branding.

## Implementação

1. Copiar os logos originais para `apps/chat-web/public/brand/`, sem redesenhar.
2. Centralizar a paleta e superfícies em `src/index.css`, adaptadas pelo
   `tailwind.config.ts`. Completar tokens de card, popover, foco e scrollbar.
3. Migrar cores literais de componentes para papéis semânticos, mantendo
   hierarquia, dimensões e estados de negócio. Preservar cores de status.
4. Aplicar marca em login, cabeçalho, sidebar, estado vazio, favicon e metadados.
5. Atualizar `apps/chat-web/DESIGN.md` sem alterar os contratos de interação.
6. Executar typecheck, build e testes existentes; revisar desktop, mobile,
   controles e overlays no navegador local, usando fixtures isoladas.

## Critérios de aceite

- Nenhuma referência ENS/Nexus na identidade visível do frontend.
- Logo original sem distorção, fundo azul profundo e ações azul Prometeus.
- Texto legível, foco identificável, menus/modais opacos e movimento reduzido.
- Fluxos existentes preservados; nenhuma alteração em infraestrutura ou backend.
- Sem deploy: a operação de produção continua exclusiva do responsável humano.

## Verificação realizada

- Typecheck e build do frontend aprovados.
- 42 arquivos / 199 testes unitários e de componentes aprovados.
- 3 testes E2E em `apps/chat-web/e2e/prometeus-brand.spec.ts` aprovados com
  `E2E_FAKE_MODE=marketing-ops`: login, chat, menu, campanhas, validação de
  responsável, modal, produção, teclado, viewport mobile e movimento reduzido.
  Contraste verificado com axe nos estados exercitados.
- Revisão visual no navegador local com fixtures sem conexão com produção.
- Logos e símbolo copiados sem transformação; hashes conferidos com os originais.
- Revisão independente concluída; corrigidos contraste de mensagens de status
  sem fundo próprio e placeholder de e-mail residual da ENS.
- Lint global continua com 1 erro preexistente (`no-explicit-any` em
  `AgentPlanCard.test.tsx:177`) e 10 avisos. Nenhum erro novo no diff.
- Auditoria estática premium: 39 apontamentos também presentes no HEAD,
  conferidos em cópia isolada do código anterior; nenhum novo apontamento.
  Referem-se a contratos/controles existentes, fora da alteração de identidade.
- Build mantém avisos de Browserslist desatualizado e tamanho de chunk.

As referências técnicas `NEXUS_CHAT_MESSAGE`, cabeçalhos `X-Nexus-*` e origem
interna do parser de deep links foram preservadas por compatibilidade.
