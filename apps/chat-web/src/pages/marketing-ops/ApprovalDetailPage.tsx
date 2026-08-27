import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, Ban, Check, ClipboardCheck, MessageSquareWarning, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { ApprovalDecisionDialog } from '@/components/marketing-ops/ApprovalDecisionDialog';
import { ApprovalPreview } from '@/components/marketing-ops/ApprovalPreview';
import { MarketingOpsMobileBar } from '@/components/marketing-ops/MarketingOpsMobileBar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarketingOpsApiError, type MarketingOpsClient } from '@/lib/marketingOps/client';
import { marketingOpsKeys } from '@/lib/marketingOps/queryKeys';
import { marketingOpsClient } from '@/lib/marketingOps/runtime';
import type { MarketingOpsApprovalDecisionInput } from '@/lib/marketingOps/types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const makeKey = () => globalThis.crypto.randomUUID();

export default function ApprovalDetailPage({ client = marketingOpsClient, idempotencyKey = makeKey }: {
  client?: MarketingOpsClient; idempotencyKey?: () => string;
}) {
  const { requestId = '' } = useParams();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<MarketingOpsApprovalDecisionInput['decision'] | null>(null);
  const valid = uuid.test(requestId);
  const query = useQuery({ queryKey: marketingOpsKeys.approval(requestId), queryFn: () => client.getApprovalRequest(requestId), enabled: valid });
  const mutation = useMutation({
    mutationFn: (input: MarketingOpsApprovalDecisionInput) => client.decideApproval(requestId, query.data!.data.version, input, idempotencyKey()),
    onSuccess: async (response) => {
      queryClient.setQueryData(marketingOpsKeys.approval(requestId), (current: typeof response | undefined) => ({
        ...response,
        data: {
          ...response.data,
          editorialTarget: response.data.editorialTarget ?? current?.data.editorialTarget ?? null
        }
      }));
      await queryClient.invalidateQueries({ queryKey: marketingOpsKeys.approval(requestId) });
      setDecision(null);
    }
  });
  const cancelMutation = useMutation({
    mutationFn: () => client.cancelApproval(requestId, query.data!.data.version, idempotencyKey()),
    onSuccess: async (response) => {
      queryClient.setQueryData(marketingOpsKeys.approval(requestId), (current: typeof response | undefined) => ({
        ...response,
        data: {
          ...response.data,
          editorialTarget: response.data.editorialTarget ?? current?.data.editorialTarget ?? null
        }
      }));
      await queryClient.invalidateQueries({ queryKey: marketingOpsKeys.approval(requestId) });
    }
  });
  const approval = query.data?.data;
  const operationError = mutation.error ?? cancelMutation.error;
  const apiError = operationError instanceof MarketingOpsApiError ? operationError : null;
  const isConflict = apiError?.status === 409;
  const errorTitle = isConflict
    ? 'Conflito ao atualizar a aprovação'
    : 'Não foi possível concluir a decisão';
  const errorDescription = isConflict
    ? 'Atualize a solicitação e confira o estado já registrado.'
    : apiError?.status === 403
      ? 'Seu perfil não tem permissão para realizar esta decisão.'
      : 'O serviço não concluiu a operação. Tente novamente e use a correlação abaixo caso o erro persista.';
  return <div className="min-h-screen text-text-primary"><Sidebar />
    <MarketingOpsMobileBar label="Detalhe da aprovação" icon={<ClipboardCheck className="h-4 w-4 text-brand-primary" />} />
    <main className="min-h-screen md:ml-20"><div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 md:py-8">
      <Link to="/marketing-ops/approvals" className="inline-flex items-center text-sm font-medium"><ArrowLeft className="mr-2 h-4 w-4" />Voltar à fila</Link>
      {!valid ? <Alert variant="destructive" className="mt-5"><AlertCircle className="h-4 w-4" /><AlertTitle>Identificador inválido</AlertTitle></Alert>
        : query.isLoading ? <p className="mt-6">Carregando aprovação…</p>
          : query.isError || !approval ? <Alert variant="destructive" className="mt-5"><AlertCircle className="h-4 w-4" /><AlertTitle>Não foi possível carregar a aprovação</AlertTitle><AlertDescription><Button variant="outline" onClick={() => query.refetch()}>Tentar novamente</Button></AlertDescription></Alert>
            : <>
              <header className="my-5"><div className="flex flex-wrap gap-2"><Badge>{approval.status}</Badge><Badge variant="outline">{approval.kind}</Badge><Badge variant="secondary">Risco {approval.riskLevel}</Badge></div>
                <h1 className="mt-3 text-3xl font-bold">Solicitação de aprovação</h1><p className="mt-2 text-text-secondary">{approval.reason}</p></header>
              <ApprovalPreview approval={approval} />
              <section className="mt-4 rounded-lg border bg-white/70 p-4"><h2 className="font-semibold">Histórico</h2>
                <ol className="mt-2 grid gap-2 text-sm"><li>Solicitada por {approval.requestedBy} em {new Date(approval.createdAt).toLocaleString('pt-BR')}</li>
                  {approval.supersedesRequestId ? <li>Ciclo anterior: <Link className="underline" to={`/marketing-ops/approvals/${approval.supersedesRequestId}`}>{approval.supersedesRequestId}</Link></li> : null}
                  {approval.decision ? <li><p>Decisão: {approval.decision.decision} em {new Date(approval.decision.createdAt).toLocaleString('pt-BR')}</p>
                    <p>{approval.decision.origin === 'system' ? 'Pelo sistema' : `Por ${approval.decision.decidedBy} (${approval.decision.deciderRole})`}</p>
                    {approval.decision.comment ? <p>Comentário: {approval.decision.comment}</p> : null}</li> : null}
                  {approval.actionPackage?.invalidationReason ? <li>Pacote invalidado: {approval.actionPackage.invalidationReason}</li> : null}</ol></section>
              {operationError ? <Alert variant="destructive" className="mt-4"><AlertCircle className="h-4 w-4" /><AlertTitle>{errorTitle}</AlertTitle><AlertDescription>{errorDescription}{apiError?.correlationId ? <span className="mt-1 block font-mono text-xs">Correlação: {apiError.correlationId}</span> : null}</AlertDescription></Alert> : null}
              {approval.capabilities.decide ? <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={() => setDecision('approved')}><Check className="mr-2 h-4 w-4" />Aprovar</Button>
                <Button variant="outline" onClick={() => setDecision('changes_requested')}><MessageSquareWarning className="mr-2 h-4 w-4" />Solicitar ajustes</Button>
                <Button variant="destructive" onClick={() => setDecision('rejected')}><X className="mr-2 h-4 w-4" />Rejeitar</Button>
              </div> : null}
              {approval.capabilities.cancel ? <Button className="mt-5" variant="destructive" disabled={cancelMutation.isPending} onClick={() => { if (globalThis.confirm('Cancelar definitivamente esta solicitação?')) void cancelMutation.mutateAsync().catch(() => undefined); }}><Ban className="mr-2 h-4 w-4" />Cancelar solicitação</Button> : null}
              <ApprovalDecisionDialog decision={decision} pending={mutation.isPending} criticalRisk={approval.riskLevel === 'critical'} onOpenChange={(open) => { if (!open) setDecision(null); }} onConfirm={async (input) => { await mutation.mutateAsync(input).catch(() => undefined); }} />
            </>}
    </div></main>
  </div>;
}
