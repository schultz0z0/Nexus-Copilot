import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  workspaceClient,
  workspaceKeys,
  type WorkspaceClient,
  type WorkspaceConnection,
  type SearchConsoleReport,
} from "@/lib/marketingOps/workspace";
import { validAdsPeriod } from "@/lib/marketingOps/ads";
import { LeadError } from "./LeadUi";
import { count, shortDate, useProposalKey } from "./leadUiHelpers";
const date = (days: number) =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
export function SearchConsoleResults({
  connection,
  canManage,
  api = workspaceClient,
}: {
  connection: WorkspaceConnection;
  canManage: boolean;
  api?: WorkspaceClient;
}) {
  const qc = useQueryClient();
  const key = useProposalKey();
  const [period, setPeriod] = useState({ from: date(30), to: date(3) });
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const valid =
    validAdsPeriod(period) && period.to < new Date().toISOString().slice(0, 10);
  const report = useQuery({
    queryKey: ["workspace", "search-report", connection.generation, period],
    queryFn: () => api.report(period),
    enabled: valid,
    retry: false,
  });
  const sync = async () => {
    if (lock.current || !valid) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setOutcome("");
    try {
      const response = await api.syncReport(
        period,
        connection.version,
        key({ period, version: connection.version }),
      );
      qc.setQueryData(
        ["workspace", "search-report", connection.generation, period],
        response,
      );
      setOutcome("Leitura do Search Console atualizada.");
      await qc.invalidateQueries({ queryKey: workspaceKeys.connections });
    } catch (issue) {
      setError(issue);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="space-y-6" aria-label="Desempenho da busca orgânica">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium">Busca orgânica</h2>
          <p className="mt-2 break-all text-sm text-muted-foreground">
            {connection.selectedResource?.name}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="search-from">De</Label>
            <Input
              id="search-from"
              type="date"
              value={period.from}
              onChange={(event) =>
                setPeriod({ ...period, from: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="search-to">Até</Label>
            <Input
              id="search-to"
              type="date"
              max={date(1)}
              value={period.to}
              onChange={(event) =>
                setPeriod({ ...period, to: event.target.value })
              }
            />
          </div>
          {canManage && (
            <Button
              className="min-h-11"
              disabled={
                busy ||
                !valid ||
                !["connected", "partial"].includes(connection.status)
              }
              onClick={() => {
                void sync();
              }}
            >
              {busy ? "Atualizando…" : "Atualizar busca orgânica"}
            </Button>
          )}
        </div>
      </header>
      <p className="text-xs text-muted-foreground">
        Dados de busca podem levar alguns dias para consolidar. Cliques e
        impressões não representam leads ou vendas.
      </p>
      {!valid && (
        <LeadError
          error={new Error("Escolha até 30 dias completos, sem datas futuras.")}
        />
      )}
      <LeadError
        error={error || report.error}
        retry={() => {
          void report.refetch();
        }}
      />
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-status-success"
      >
        {outcome}
      </p>
      {report.isLoading && <p role="status">Carregando leitura orgânica…</p>}
      {report.data && <OrganicReport report={report.data.data} />}
    </section>
  );
}
function OrganicReport({ report }: { report: SearchConsoleReport }) {
  const percent = (value: number) =>
    `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value * 100)}%`;
  if (!report.totals)
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Ainda não há leitura salva neste período. Atualize a busca orgânica para
        consultar a propriedade.
      </div>
    );
  return (
    <>
      <div className="grid grid-cols-2 gap-5 border-y border-border py-6 md:grid-cols-4">
        {[
          ["Cliques", count(report.totals.clicks)],
          ["Impressões", count(report.totals.impressions)],
          ["CTR", percent(report.totals.ctr)],
          [
            "Posição média",
            new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
              report.totals.position,
            ),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-medium tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      {report.stale && (
        <p className="text-sm text-status-warning">
          Esta leitura está desatualizada. Os dados anteriores foram
          preservados.
        </p>
      )}
      {report.lastSyncAt && (
        <p className="text-xs text-muted-foreground">
          Última leitura: {new Date(report.lastSyncAt).toLocaleString("pt-BR")}
        </p>
      )}
      {report.daily.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-base font-medium">Evolução da busca</h3>
          <div
            className="mt-5 h-64"
            aria-label="Gráfico de cliques e impressões por dia"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={report.daily}
                margin={{ left: 0, right: 0, top: 10, bottom: 0 }}
              >
                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => shortDate(value).slice(0, 5)}
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fontSize: 11 }}
                  minTickGap={30}
                />
                <YAxis
                  yAxisId="clicks"
                  stroke="hsl(var(--muted-foreground))"
                  width={40}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  yAxisId="impressions"
                  orientation="right"
                  stroke="hsl(var(--muted-foreground))"
                  width={48}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                  }}
                  labelFormatter={(label) => shortDate(String(label))}
                />
                <Legend />
                <Line
                  name="Cliques"
                  yAxisId="clicks"
                  dataKey="clicks"
                  stroke="hsl(var(--brand-accent))"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  name="Impressões"
                  yAxisId="impressions"
                  dataKey="impressions"
                  stroke="hsl(var(--text-secondary))"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-4 text-sm">
            <summary className="min-h-11 cursor-pointer py-3 text-brand-accent">
              Ver valores diários
            </summary>
            <div
              tabIndex={0}
              role="region"
              aria-label="Valores diários"
              className="overflow-x-auto"
            >
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="p-3">Dia</th>
                    <th className="p-3">Cliques</th>
                    <th className="p-3">Impressões</th>
                  </tr>
                </thead>
                <tbody>
                  {report.daily.map((row) => (
                    <tr key={row.date} className="border-t border-border">
                      <td className="p-3">{shortDate(row.date)}</td>
                      <td className="p-3 tabular-nums">{count(row.clicks)}</td>
                      <td className="p-3 tabular-nums">
                        {count(row.impressions)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {[
          {
            title: "Consultas de busca",
            rows: report.queries.map((row) => ({ ...row, label: row.query })),
          },
          {
            title: "Páginas encontradas",
            rows: report.pages.map((row) => ({ ...row, label: row.page })),
          },
        ].map((group) => (
          <section
            key={group.title}
            className="min-w-0 rounded-xl border border-border bg-card p-5"
          >
            <h3 className="font-medium">{group.title}</h3>
            <div
              tabIndex={0}
              role="region"
              aria-label={group.title}
              className="mt-4 max-h-96 overflow-auto"
            >
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="p-3">
                      {group.title === "Consultas de busca"
                        ? "Consulta"
                        : "Página"}
                    </th>
                    <th className="p-3">Cliques</th>
                    <th className="p-3">Impressões</th>
                    <th className="p-3">CTR</th>
                    <th className="p-3">Posição</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      <td className="max-w-60 break-all p-3 text-muted-foreground">
                        {row.label}
                      </td>
                      <td className="p-3 tabular-nums">{count(row.clicks)}</td>
                      <td className="p-3 tabular-nums">
                        {count(row.impressions)}
                      </td>
                      <td className="p-3 tabular-nums">{percent(row.ctr)}</td>
                      <td className="p-3 tabular-nums">
                        {row.position.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!group.rows.length && (
                <p className="py-4 text-sm text-muted-foreground">
                  Nenhuma linha informada pelo provedor neste recorte.
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Consultas e páginas mostram até 100 principais linhas retornadas pelo
        Google; podem omitir buscas por privacidade. Os indicadores gerais vêm
        de uma consulta agregada independente e não da soma destas tabelas.
        {report.truncated ? " O limite de linhas foi atingido." : ""}
      </p>
    </>
  );
}
