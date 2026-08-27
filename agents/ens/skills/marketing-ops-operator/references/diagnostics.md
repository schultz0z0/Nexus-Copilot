# Safe Marketing Ops diagnostics

Use this reference after an error. Diagnose before retrying, keep all checks
read-only unless a new plan is explicitly requested, and never log or reveal
tokens, full prompts, user content, or raw authorization data.

## Triage order

1. Confirm the last successful boundary: app → Bridge → Hermes → MCP →
   Marketing Ops → Supabase.
2. Determine whether a plan was prepared. A failed prepare means no plan and
   no write; a failed execution must be reported as a failure, not a success.
3. Inspect only sanitized service logs: tool name, decision enum, response
   contract flag, correlation ID, status class, and structural payload type.
4. Ask the user for a business clarification only if it is genuinely missing;
   otherwise report the operational limitation and stop.

## Common signatures

| Sanitized symptom | Likely boundary | Action |
|---|---|---|
| JSON-RPC `-32602`, `expected array`, `invalid_type` | Provider serialization or input schema | Confirm that `actions` reached the service as an array-compatible structure. The service accepts only native arrays, `item` wrappers, direct typed action objects, or JSON-encoded forms of those; all then remain strictly validated. |
| `confirmation_required` | Context classifier or Bridge confirmation intent | Check only the decision enum and `output_contract` log fields. Never claim execution; retain the plan and request clarification if the user intent was not approved. |
| `delegation_scope_denied`, expired, or replay | Authorization lifecycle | Do not ask the user for a token. Start a fresh read/prepare cycle as appropriate. |
| Version conflict | Transactional state changed | Re-read the object, prepare a revised plan, and require new confirmation. |
| Unavailable MCP/RAG/Graph | Dependency availability | State the affected verification is unavailable; do not fabricate a result or switch to direct database access. |

## Evidence checklist

For a release incident, record only: timestamp, deployed commit, service
health, sanitized tool/status, decision enum when applicable, whether a plan
was prepared, whether domain persistence occurred, and correlation ID where
authorized. This distinguishes bad serialization from a Bridge issue, a
classifier issue, a dependency outage, or a domain rejection without leaking
credentials.
