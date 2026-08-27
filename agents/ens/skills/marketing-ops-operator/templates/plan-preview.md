# Natural plan-preview template

Use after `marketing_ops_prepare_plan_v1` succeeds. Replace brackets only
with server-returned plan details and the user’s requested business terms.

> Vou preparar [resultado] com estas ações:
>
> - Campanha resolvida: [nome exato retornado pelo Marketing Ops]
> - Item resolvido: [título exato retornado pelo Marketing Ops]
> - Conteúdo resolvido: [título exato retornado pelo Marketing Ops]
> - [ação 1 em linguagem natural]
> - [ação 2 em linguagem natural, se houver]
>
> Nada foi salvo ainda. Quer que eu execute exatamente este plano?

Rules:

- Do not display tokens, IDs, versions, scopes, tool names, raw payloads, or
  internal error details.
- For a write to an existing object, include every applicable resolved parent
  and target line. Omit only genuinely inapplicable lines, never a known
  target. Exact server-returned labels are business data and must remain
  visible.
- If an exact label was not returned or multiple exact candidates remain, do
  not show a plan preview. Ask for the missing business context.
- Do not promise a deep link before execution returns one.
- For approval submission, state the exact version or operational package
  summary and explicitly say that this confirmation submits for human review;
  it does not approve or execute the underlying action.
- Keep every planned action visible; a vague “confirmar?” is insufficient for
  multiple actions.
- If the user changes any detail, do not execute this preview. Prepare and
  display the revised plan instead.
