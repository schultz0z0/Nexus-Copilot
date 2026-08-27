import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, Megaphone, RefreshCw, Save, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { CampaignFieldsForm } from '@/components/marketing-ops/CampaignFieldsForm';
import {
  campaignPatch,
  campaignToFormValues,
  validateCampaignForm,
  type CampaignFormErrors,
  type CampaignFormValues
} from '@/components/marketing-ops/campaignForm';
import { CampaignHeader } from '@/components/marketing-ops/CampaignHeader';
import { MaterialsPanel } from '@/components/marketing-ops/MaterialsPanel';
import { MarketingOpsMobileBar } from '@/components/marketing-ops/MarketingOpsMobileBar';
import { ParticipantsPanel } from '@/components/marketing-ops/ParticipantsPanel';
import { TimelinePanel } from '@/components/marketing-ops/TimelinePanel';
import { VersionConflictDialog } from '@/components/marketing-ops/VersionConflictDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { MarketingOpsApiError, type MarketingOpsClient } from '@/lib/marketingOps/client';
import { marketingOpsFlags } from '@/lib/marketingOps/flags';
import { marketingOpsKeys } from '@/lib/marketingOps/queryKeys';
import { marketingOpsClient } from '@/lib/marketingOps/runtime';
import { validationIssues } from '@/lib/marketingOps/validationIssues';
import type {
  MarketingOpsCampaign,
  MarketingOpsCampaignPatch,
  MarketingOpsTenantRole,
  MarketingOpsTransitionTarget
} from '@/lib/marketingOps/types';

interface CampaignWorkspacePageProps {
  client?: MarketingOpsClient;
  canWrite?: boolean;
  canArchive?: boolean;
  tenantRole?: MarketingOpsTenantRole;
  currentUserId?: string | null;
  referenceDebounceMs?: number;
  idempotencyKey?: () => string;
}

interface ConflictState {
  current: MarketingOpsCampaign;
  patch: MarketingOpsCampaignPatch;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function defaultIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function errorDetails(error: unknown): { status: number | null; message: string; correlationId: string | null; details?: unknown } {
  const candidate = error as { status?: unknown; message?: unknown; correlationId?: unknown; details?: unknown } | null;
  return {
    status: typeof candidate?.status === 'number' ? candidate.status : null,
    message: typeof candidate?.message === 'string' ? candidate.message : 'Não foi possível concluir a operação.',
    correlationId: typeof candidate?.correlationId === 'string' ? candidate.correlationId : null,
    details: candidate?.details
  };
}

function WorkspaceFailure({
  title,
  description,
  correlationId,
  onRetry
}: {
  title: string;
  description: string;
  correlationId?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="relative min-h-screen overflow-x-hidden text-text-primary">
      <Sidebar />
      <MarketingOpsMobileBar label="Campanhas" icon={<Megaphone className="h-4 w-4 text-brand-primary" />} />
      <div className="min-h-screen md:ml-20">
        <div className="mx-auto flex min-h-screen max-w-3xl items-center px-4 py-10 sm:px-6">
          <Alert variant="destructive" className="rounded-[8px] border-white/60 bg-white/80 shadow-glass backdrop-blur-xl">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription>
              <p>{description}</p>
              {correlationId ? <p className="mt-1 text-xs">Correlação: {correlationId}</p> : null}
              {onRetry ? (
                <Button type="button" variant="outline" onClick={onRetry} className="mt-4 h-10 rounded-[8px]">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Tentar novamente
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}

function CampaignWorkspace({
  initialCampaign,
  client,
  canWrite,
  canArchive,
  tenantRole,
  currentUserId,
  referenceDebounceMs,
  idempotencyKey
}: {
  initialCampaign: MarketingOpsCampaign;
  client: MarketingOpsClient;
  canWrite: boolean;
  canArchive: boolean;
  tenantRole: MarketingOpsTenantRole;
  currentUserId: string | null;
  referenceDebounceMs: number;
  idempotencyKey: () => string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [campaign, setCampaign] = useState(initialCampaign);
  const [values, setValues] = useState<CampaignFormValues>(() => campaignToFormValues(initialCampaign));
  const [errors, setErrors] = useState<CampaignFormErrors>({});
  const [operationError, setOperationError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const participantsQuery = useQuery({
    queryKey: marketingOpsKeys.participants(initialCampaign.id),
    queryFn: () => client.listParticipants(initialCampaign.id)
  });
  const currentParticipant = participantsQuery.data?.data.find((participant) => participant.userId === currentUserId);
  const managesTenant = tenantRole === 'manager' || tenantRole === 'admin';
  const canEditCampaign = canWrite && (
    managesTenant || currentParticipant?.memberRole === 'owner' || currentParticipant?.memberRole === 'editor'
  );
  const canTransitionCampaign = canWrite && (
    managesTenant || (currentParticipant?.memberRole === 'owner' && currentParticipant.isPrimary)
  );
  const canArchiveCampaign = canArchive && managesTenant;
  const patch = campaignPatch(campaign, values);
  const dirty = Object.keys(patch).length > 0;
  const readOnly = !canEditCampaign || campaign.status === 'archived';
  const nestedReadOnly = !canWrite || campaign.status === 'archived';
  const details = errorDetails(operationError);
  const issues = validationIssues(details.details);

  const applyCampaign = (next: MarketingOpsCampaign) => {
    setCampaign(next);
    setValues(campaignToFormValues(next));
    setErrors({});
    setOperationError(null);
    queryClient.setQueryData(marketingOpsKeys.campaign(next.id), (previous: unknown) => {
      if (!previous || typeof previous !== 'object') return previous;
      return { ...previous, data: next };
    });
    void queryClient.invalidateQueries({ queryKey: marketingOpsKeys.campaigns() });
    void queryClient.invalidateQueries({ queryKey: marketingOpsKeys.timeline(next.id) });
  };

  const applyCampaignVersion = (version: number) => {
    setCampaign((current) => {
      const next = { ...current, version };
      queryClient.setQueryData(marketingOpsKeys.campaign(next.id), (previous: unknown) => {
        if (!previous || typeof previous !== 'object') return previous;
        return { ...previous, data: next };
      });
      return next;
    });
    void queryClient.invalidateQueries({ queryKey: marketingOpsKeys.campaigns() });
  };

  const loadConflict = async (localPatch: MarketingOpsCampaignPatch) => {
    const fresh = await client.getCampaign(campaign.id);
    setConflict({ current: fresh.data, patch: localPatch });
  };

  const save = async () => {
    if (readOnly || saving) return;
    const nextErrors = validateCampaignForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const localPatch = campaignPatch(campaign, values);
    if (Object.keys(localPatch).length === 0) return;

    setSaving(true);
    setOperationError(null);
    try {
      const response = await client.updateCampaign(
        campaign.id,
        campaign.version,
        localPatch,
        idempotencyKey()
      );
      applyCampaign(response.data);
    } catch (error) {
      if (error instanceof MarketingOpsApiError && error.status === 409 && error.currentVersion) {
        try {
          await loadConflict(localPatch);
        } catch (refreshError) {
          setOperationError(refreshError);
        }
      } else {
        setOperationError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  const reapplyConflict = async () => {
    if (!conflict || saving) return;
    setSaving(true);
    setOperationError(null);
    try {
      const response = await client.updateCampaign(
        campaign.id,
        conflict.current.version,
        conflict.patch,
        idempotencyKey()
      );
      setConflict(null);
      applyCampaign(response.data);
    } catch (error) {
      if (error instanceof MarketingOpsApiError && error.status === 409 && error.currentVersion) {
        try {
          await loadConflict(conflict.patch);
        } catch (refreshError) {
          setOperationError(refreshError);
        }
      } else {
        setOperationError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  const transition = async (to: MarketingOpsTransitionTarget) => {
    if (readOnly || dirty || statusBusy) return;
    setStatusBusy(true);
    setOperationError(null);
    try {
      const response = await client.transitionCampaign(campaign.id, campaign.version, to, idempotencyKey());
      applyCampaign(response.data);
    } catch (error) {
      setOperationError(error);
    } finally {
      setStatusBusy(false);
    }
  };

  const archive = async () => {
    if (!canArchiveCampaign || dirty || statusBusy) return;
    setStatusBusy(true);
    setOperationError(null);
    try {
      const response = await client.archiveCampaign(campaign.id, campaign.version, idempotencyKey());
      setArchiveOpen(false);
      applyCampaign(response.data);
    } catch (error) {
      setOperationError(error);
    } finally {
      setStatusBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden text-text-primary">
      <Sidebar />

      <MarketingOpsMobileBar
        label="Workspace da campanha"
        icon={<Megaphone className="h-4 w-4 text-brand-primary" />}
      />

      <main className="min-h-screen md:ml-20">
        <CampaignHeader
          campaign={campaign}
          canWrite={canEditCampaign}
          canTransition={canTransitionCampaign}
          canArchive={canArchiveCampaign}
          dirty={dirty}
          busy={saving || statusBusy}
          onBack={() => navigate('/marketing-ops/campaigns')}
          onTransition={transition}
          onArchive={() => setArchiveOpen(true)}
        />

        {operationError ? (
          <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-6 md:px-8">
            <Alert variant="destructive" className="rounded-[8px] border-white/60 bg-white/80 shadow-glass backdrop-blur-xl">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Não foi possível concluir a operação</AlertTitle>
              <AlertDescription>
                <p>{details.message}</p>
                {issues ? (
                  <ul className="mt-2 list-disc pl-5 text-xs text-red-850">
                    {issues.map((issue, index) => (
                      <li key={index}>
                        <strong>Campo "{issue.path.join('.') || 'geral'}":</strong> {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {details.correlationId ? <p className="mt-1 text-xs">Correlação: {details.correlationId}</p> : null}
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <CampaignFieldsForm
          values={values}
          errors={errors}
          disabled={readOnly || saving || statusBusy}
          client={client}
          referenceDebounceMs={referenceDebounceMs}
          onChange={(next) => {
            setValues((current) => ({ ...current, ...next }));
            setErrors({});
            setOperationError(null);
          }}
          onSubmit={save}
        />

        <ParticipantsPanel
          campaignId={campaign.id}
          campaignVersion={campaign.version}
          client={client}
          tenantRole={tenantRole}
          currentUserId={currentUserId}
          readOnly={nestedReadOnly}
          idempotencyKey={idempotencyKey}
          onCampaignVersionChange={applyCampaignVersion}
        />

        <MaterialsPanel
          campaignId={campaign.id}
          campaignVersion={campaign.version}
          client={client}
          tenantRole={tenantRole}
          currentUserId={currentUserId}
          readOnly={nestedReadOnly}
          idempotencyKey={idempotencyKey}
          onCampaignVersionChange={applyCampaignVersion}
        />

        <TimelinePanel
          campaignId={campaign.id}
          client={client}
          reserveFooterSpace={!readOnly}
        />

        {!readOnly ? (
          <div className="sticky bottom-0 z-30 border-t border-white/50 bg-white/75 px-4 py-3 shadow-[0_-10px_30px_-24px_rgba(11,18,32,0.45)] backdrop-blur-xl sm:px-6 md:px-8">
            <div className="mx-auto flex max-w-5xl items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || saving || statusBusy}
                onClick={() => {
                  setValues(campaignToFormValues(campaign));
                  setErrors({});
                  setOperationError(null);
                }}
                className="h-11 rounded-[8px] bg-white/80"
              >
                <Undo2 className="mr-2 h-4 w-4" />
                Descartar
              </Button>
              <Button
                type="submit"
                form="campaign-workspace-form"
                disabled={!dirty || saving || statusBusy}
                className="h-11 rounded-[8px]"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar alterações
              </Button>
            </div>
          </div>
        ) : null}
      </main>

      <VersionConflictDialog
        open={Boolean(conflict)}
        current={conflict?.current ?? null}
        patch={conflict?.patch ?? {}}
        pending={saving}
        onDiscard={() => {
          if (!conflict) return;
          const current = conflict.current;
          setConflict(null);
          applyCampaign(current);
        }}
        onReapply={reapplyConflict}
      />

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent className="rounded-[8px] border-white/60 bg-white/90 text-text-primary shadow-glass backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar campanha</AlertDialogTitle>
            <AlertDialogDescription>
              A campanha ficará somente leitura e manterá participantes, materiais e histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={statusBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={statusBusy} onClick={(event) => {
              event.preventDefault();
              void archive();
            }}>
              {statusBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar arquivamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function CampaignWorkspacePage({
  client = marketingOpsClient,
  canWrite,
  canArchive,
  tenantRole,
  currentUserId,
  referenceDebounceMs = 300,
  idempotencyKey = defaultIdempotencyKey
}: CampaignWorkspacePageProps) {
  const { campaignId = '' } = useParams();
  const { normalizedRole, profile, user } = useAuth();
  const flags = marketingOpsFlags(import.meta.env);
  const writeAllowed = canWrite ?? flags.write;
  const effectiveTenantRole = tenantRole ?? normalizedRole;
  const effectiveUserId = currentUserId === undefined ? (profile?.id ?? user?.id ?? null) : currentUserId;
  const archiveAllowed = canArchive ?? (
    writeAllowed && (effectiveTenantRole === 'manager' || effectiveTenantRole === 'admin')
  );
  const validId = uuidPattern.test(campaignId);
  const campaignQuery = useQuery({
    queryKey: marketingOpsKeys.campaign(campaignId),
    queryFn: () => client.getCampaign(campaignId),
    enabled: validId
  });

  if (!validId) {
    return <WorkspaceFailure title="Link de campanha inválido" description="O identificador informado não é válido." />;
  }

  if (campaignQuery.isLoading) {
    return (
      <div className="relative min-h-screen overflow-x-hidden text-text-primary">
        <Sidebar />
        <MarketingOpsMobileBar label="Workspace da campanha" icon={<Megaphone className="h-4 w-4 text-brand-primary" />} />
        <div className="md:ml-20">
          <div aria-label="Carregando workspace" className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6 md:px-8">
            <div className="h-8 w-2/3 animate-pulse rounded bg-slate-200" />
            <div className="glass-surface shadow-glass h-36 animate-pulse rounded-[8px] border-white/60" />
            <div className="glass-surface shadow-glass h-72 animate-pulse rounded-[8px] border-white/60" />
          </div>
        </div>
      </div>
    );
  }

  if (campaignQuery.isError) {
    const details = errorDetails(campaignQuery.error);
    if (details.status === 404) {
      return (
        <WorkspaceFailure
          title="Campanha não encontrada"
          description="A campanha não existe ou não está mais disponível."
          correlationId={details.correlationId}
        />
      );
    }
    if (details.status === 403) {
      return (
        <WorkspaceFailure
          title="Acesso não autorizado"
          description="Seu perfil não possui acesso a esta campanha."
          correlationId={details.correlationId}
        />
      );
    }
    return (
      <WorkspaceFailure
        title="Não foi possível carregar a campanha"
        description="Tente novamente. Se o erro persistir, informe o código de correlação."
        correlationId={details.correlationId}
        onRetry={() => campaignQuery.refetch()}
      />
    );
  }

  return (
    <CampaignWorkspace
      initialCampaign={campaignQuery.data.data}
      client={client}
      canWrite={writeAllowed}
      canArchive={archiveAllowed}
      tenantRole={effectiveTenantRole}
      currentUserId={effectiveUserId}
      referenceDebounceMs={referenceDebounceMs}
      idempotencyKey={idempotencyKey}
    />
  );
}
