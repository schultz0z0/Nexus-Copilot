import { Button } from '@/components/ui/button';
export function LeadError({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  const detail = error as { message?: string; correlationId?: string };
  return <div role="alert" className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm text-status-error"><p>{detail.message ?? 'Não foi possível carregar os dados.'}</p>{detail.correlationId && <p className="break-all text-xs">Correlação: {detail.correlationId}</p>}{retry && <Button variant="outline" className="min-h-11" onClick={retry}>Tentar novamente</Button>}</div>;
}
