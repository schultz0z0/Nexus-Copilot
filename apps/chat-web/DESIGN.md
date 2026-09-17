# Chat Web design contract

This file records the durable visual and interaction rules of the ENS Chat Web.
It complements component tests; it does not replace product authorization,
accessibility checks, or the Marketing Ops security contracts.

## Visual language

- The product uses a warm, pale canvas with translucent white surfaces, soft
  shadows and the existing ENS cyan/teal brand accent.
- Typography follows the application font stack declared in `src/index.css`.
  Headings are compact and high contrast; body copy stays readable at normal
  browser zoom without relying on very small text for primary information.
- Cards use the established rounded surface language (`rounded-xl` or
  `rounded-2xl`), subtle borders and restrained shadows. New flows must reuse
  these primitives instead of introducing an unrelated visual theme.
- Color never carries state alone. Status color is paired with an icon and a
  Portuguese text label.

## Interaction rules

- The browser talks only to the App API/BFF. UI code must never call PostgreSQL,
  Hermes or an internal Marketing Ops endpoint directly.
- Mutations require explicit controls. Model prose and typed confirmation are
  not substitutes for the **Executar plano** button.
- Buttons expose visible focus, disabled and busy states. Destructive or
  critical actions require an additional explicit confirmation.
- Links returned by Marketing Ops are internal deep links and must remain
  bounded to known application routes.

## Structured Marketing Ops plans

- A pending card is an executable proposal, not a chat message. It comes from
  the server-owned plan read model and displays plan ID/hash, immutable actions,
  expiry and one explicit **Executar plano** control.
- A card may contain several related actions. A chat exposes at most one pending
  executable plan; a revised plan replaces the previous pending card.
- Terminal cards are durable receipts sourced from PostgreSQL. They remain
  visible after query refresh or page reload and never render an execution
  button.
- Receipt labels are unambiguous: **Plano concluído**, **Plano concluído
  parcialmente**, **Plano não concluído**, **Plano expirado** or **Plano
  substituído**.
- Creating an approval request is not approval. The receipt must say
  **Solicitação de aprovação criada — pendente** until a separate eligible
  human records a decision in the approvals flow.
- Result links are secondary actions. The execution result and its timestamp
  remain legible even when no deep link exists.

## Accessibility and responsive behavior

- Mutation outcomes are announced through `aria-live` and also remain visible
  as persistent text; transient toast-only confirmation is insufficient.
- Controls need accessible names and keyboard activation. Busy cards expose
  `aria-busy`; icons used only for decoration do not replace labels.
- Chat bubbles and plan cards use bounded widths on desktop and may expand on
  small viewports without horizontal page scrolling. Long IDs, hashes and
  server messages must wrap or truncate safely.

## Maintenance

Any change to the plan lifecycle, receipt copy, status colors, or explicit
confirmation behavior must update the focused component tests and the M6
cutover runbook in the same change.
