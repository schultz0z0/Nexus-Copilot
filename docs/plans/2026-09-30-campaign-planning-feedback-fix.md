# Feedback dos requisitos para planejar uma campanha

## Diagnóstico

O erro informado em “Graduação” é o retorno HTTP 422
`campaign_requirements_missing` do domínio Marketing Ops. A leitura autenticada
do registro local confirmou objetivo/briefing salvos, responsável principal
definido e ausência de `referenceType`, `referenceTitleSnapshot`, `startsOn` e
`endsOn`. O rascunho estava na versão 2 e não foi alterado pela investigação.

O frontend exibia somente a mensagem inglesa. O domínio retorna a lista em
`details.fields`; o renderer existente só interpretava `details.issues` de Zod.

## Correção

- Traduzir os requisitos conhecidos para rótulos em português no alerta.
- Informar que o rascunho foi preservado.
- Oferecer “Completar planejamento”, selecionando a aba e focando o primeiro
  campo relevante após a montagem do painel.
- Oferecer “Definir responsável” para a aba Equipe quando aplicável.
- Explicar no formulário quais informações são necessárias para planejar,
  preservando a possibilidade de salvar um rascunho incompleto.

O domínio, a API, as permissões, a confirmação de arquivamento e os requisitos
de transição permanecem iguais. Nenhuma referência, data ou pessoa foi inventada
ou atribuída automaticamente. Nenhum dado da campanha foi editado.

## Verificação

- Regressões reproduziram o problema antes da alteração (mensagem inglesa sem
  os campos) e passaram depois: 11 testes de CampaignWorkspacePage.
- ESLint dos componentes, testes e smoke alterados: aprovado.
- Comando existente `npm run typecheck`: saída 0.
- Build Docker do frontend concluído; apenas `chat-web` recriado no localhost.
- Três testes Playwright com BFF/API reais: campanhas/produção carregam e o
  retorno 422 é explicado em desktop e mobile (390 px).
- Os testes de recuperação verificam ativação por teclado, foco, ausência de
  overflow horizontal e valores salvos. A leitura final do registro é idêntica
  à inicial, incluindo a versão.

Smoke opt-in em `e2e/marketing-local-stack.spec.ts`: apenas localhost, sessões
temporárias encerradas ao final e artefatos de autenticação desabilitados. O
cenário do erro é pulado se a campanha já estiver pronta para planejar, evitando
mudar o status de uma campanha do responsável.

Nenhum acesso ou deploy em VPS/produção.
