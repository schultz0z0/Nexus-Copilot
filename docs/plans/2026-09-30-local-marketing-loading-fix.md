# Correção do carregamento local de campanhas e produção

## Causa confirmada

O login e a resolução de sessão funcionavam, mas o BFF retornava HTTP 500 antes
de encaminhar `/api/marketing/campaigns` e `/api/marketing/campaign-items`.
Os logs apontaram `Invalid actor assertion input` em `createActorAssertion`.

O seed local usa IDs determinísticos PostgreSQL com versão/variante zero. A
validação do emissor exigia os bits de UUIDs RFC gerados, embora o IAM e o
verificador Zod do Marketing Ops aceitem esses identificadores persistidos.

## Correção

Em `services/app-api/src/marketing/assertion.js`, separar a validação de UUID de
identidade da validação de UUID de correlação. Identidades autenticadas pelo IAM
aceitam a representação canônica de UUID do PostgreSQL. A correlação continua
com a validação anterior. Não renomear IDs, migrar registros ou criar outro
usuário para contornar o problema.

Continuam obrigatórios: sessão real, papel permitido, assinatura HS256, chave
forte, issuer/audience, validade curta e vínculo a método/caminho. O Marketing
Ops continua resolvendo associação e autorização no banco.

## Verificação

- Antes da correção, login local HTTP 200 e leituras autenticadas HTTP 500.
- Testes novos reproduziram a falha no emissor e na rota BFF usando os IDs do seed.
- Após a correção, todos os 91 testes da App API passaram, inclusive rejeição de
  anônimos, identidades malformadas, correlação inválida e headers forjados.
- API local reconstruída isoladamente, preservando configuração, segredos em
  memória, rede, portas e arquivos de segredo usados pelo container anterior.
- Leituras reais de campanhas, produção e notificações retornaram HTTP 200.
- `apps/chat-web/e2e/marketing-local-stack.spec.ts`: smoke com login real e
  navegador no 8088 passou. Nenhuma interceptação de Marketing Ops, criação de
  campanha ou item; sessão de teste encerrada ao terminar. Trace/vídeo/captura
  automática desativados para não registrar cookies de autenticação.
- Banco de avaliação retorna listas vazias. As telas mostram o estado vazio;
  isso não significa indisponibilidade nem inclui dados demonstrativos.

Nenhuma ação na VPS ou mudança de identidade visual foi necessária.
