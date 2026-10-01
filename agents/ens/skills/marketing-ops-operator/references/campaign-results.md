# Weekly measured results

Read `marketing_ops_get_campaign_v1` with `include_results: true`. Its response
preserves `data` and adds `leadSources`, `reports`, and `results`. Choose only an
exact source label returned for the exact campaign. If the business source or
period is ambiguous, ask for that information; never invent a source identifier.

Prepare this action inside `marketing_ops_prepare_plan_v1.actions`:

```json
{
  "type": "campaign.results_record",
  "campaign_id": "SERVER-RETURNED-CAMPAIGN-ID",
  "report": {
    "sourceId": "SERVER-RETURNED-SOURCE-ID",
    "actionId": null,
    "periodFrom": "2026-09-21",
    "periodTo": "2026-09-27",
    "timeZone": "America/Sao_Paulo",
    "metrics": { "sent": 1000, "delivered": 920, "clicked": 50, "sales": 0 },
    "notes": "Relatório semanal informado pelo gestor"
  }
}
```

The placeholders represent authoritative IDs, not literal input values.
Allowed measured metrics: `sent`, `delivered`, `opened`, `clicked`, `responded`,
`spend`, `qualified`, `sales`, `revenue`. At least one value must be provided.
Counts are nonnegative integers; money is BRL with at most two decimals.
Do not infer missing values, conversion ratios, contacts or sales from clicks.

If correcting an existing report, add both `report_id` and `expected_version`
from the read response; include the complete replacement report, including
values to retain. Omitting a measurement in a replacement makes it unknown.
Do not append overlapping windows of the same source/action. Resolve corrections
by revising the exact existing report or ask the manager to clarify the window.

Name the campaign, source, calendar action when present, period, timezone and
all proposed measurements in the preview. Clearly state when values replace a
previous report. Preparing a plan does not record results. The user executes
the existing plan card; chat text does not authorize a second mutation.

Reports never import contacts. Cold Maps prospects stay outside captured-lead
totals. WhatsApp link clicks do not prove conversations. Read values and
coverage from `results` when explaining a dashboard; absence is not zero and
partial coverage does not establish a healthy operation.
