# Estado da migração

Data da baseline: 2026-08-27

## Verificações executadas

- Instalação por lockfile concluída nos quatro pacotes.
- Typecheck do frontend e Marketing Ops: aprovado.
- Frontend: 39 arquivos de teste e 145 testes aprovados.
- Chat Bridge: 90 testes aprovados.
- Artifact Server: 13 testes aprovados.
- Build de produção do frontend e build TypeScript do Marketing Ops: aprovados.
- Profile Distribution ENS: YAML e JSON carregados e estrutura mínima validada.

## Gate ainda vermelho

O comando agregado `npm test` não está verde porque o Marketing Ops ainda depende da infraestrutura que este corte deliberadamente não trouxe:

- testes de contrato procuram migrations Supabase antigas;
- testes de integração procuram PostgreSQL em `127.0.0.1:55322`;
- alguns testes de delegação carregam premissas temporais/runtime do fork anterior.

Isso será resolvido quando `db/migrations` receber a baseline PostgreSQL vanilla e Marketing Ops for adaptado ao novo contrato de identidade/delegação. A falha não foi mascarada nem removida dos scripts.

## Dívida de dependências herdada

- Frontend: 2 vulnerabilidades moderadas e 2 altas reportadas por `npm ci`.
- Marketing Ops: 1 vulnerabilidade alta reportada por `npm ci`.

Nenhum `npm audit fix` automático foi aplicado para evitar mudanças sem revisão no corte inicial.

## Avisos de build herdados

- bundle principal do frontend acima de 500 kB;
- importação estática e dinâmica simultânea do cliente Supabase legado;
- base Browserslist desatualizada.
