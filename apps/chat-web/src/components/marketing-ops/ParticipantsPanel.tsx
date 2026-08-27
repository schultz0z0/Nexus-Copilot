import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, RefreshCw, Trash2, UserRoundCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { marketingOpsKeys } from '@/lib/marketingOps/queryKeys';
import type {
  MarketingOpsParticipant,
  MarketingOpsParticipantRole,
  MarketingOpsResult,
  MarketingOpsTenantRole
} from '@/lib/marketingOps/types';

const roleLabels: Record<MarketingOpsParticipantRole, string> = {
  owner: 'Responsável',
  editor: 'Editor',
  viewer: 'Leitor'
};

const allRoles: MarketingOpsParticipantRole[] = ['owner', 'editor', 'viewer'];
const collaboratorRoles: MarketingOpsParticipantRole[] = ['editor', 'viewer'];
const selectClass = 'h-10 min-w-28 rounded-[8px] border border-input bg-white/80 px-2 text-sm outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-60';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function errorMessage(error: unknown): { message: string; correlationId: string | null } {
  const candidate = error as { message?: unknown; correlationId?: unknown } | null;
  return {
    message: typeof candidate?.message === 'string' ? candidate.message : 'Não foi possível concluir a operação.',
    correlationId: typeof candidate?.correlationId === 'string' ? candidate.correlationId : null
  };
}

interface ParticipantsPanelProps {
  campaignId: string;
  campaignVersion: number;
  client: MarketingOpsClient;
  tenantRole: MarketingOpsTenantRole;
  currentUserId: string | null;
  readOnly: boolean;
  candidateDebounceMs?: number;
  idempotencyKey: () => string;
  onCampaignVersionChange: (version: number) => void;
}

export function ParticipantsPanel({
  campaignId,
  campaignVersion,
  client,
  tenantRole,
  currentUserId,
  readOnly,
  candidateDebounceMs = 300,
  idempotencyKey,
  onCampaignVersionChange
}: ParticipantsPanelProps) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<MarketingOpsParticipantRole>('editor');
  const [newPrimary, setNewPrimary] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<MarketingOpsParticipant | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<unknown>(null);

  useEffect(() => {
    const normalized = candidateSearch.trim();
    const timeout = window.setTimeout(() => setDebouncedSearch(normalized), candidateDebounceMs);
    return () => window.clearTimeout(timeout);
  }, [candidateDebounceMs, candidateSearch]);

  const participantsQuery = useQuery({
    queryKey: marketingOpsKeys.participants(campaignId),
    queryFn: () => client.listParticipants(campaignId)
  });
  const participants = useMemo(() => participantsQuery.data?.data ?? [], [participantsQuery.data?.data]);
  const currentParticipant = participants.find((participant) => participant.userId === currentUserId);
  const managesTenant = tenantRole === 'manager' || tenantRole === 'admin';
  const isPrimaryOwner = currentParticipant?.memberRole === 'owner' && currentParticipant.isPrimary;
  const canManageCollaborators = !readOnly && (managesTenant || isPrimaryOwner);
  const canManageOwners = !readOnly && managesTenant;

  const candidatesQuery = useQuery({
    queryKey: marketingOpsKeys.participantCandidates(campaignId, {
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      limit: 10
    }),
    queryFn: () => client.listParticipantCandidates(campaignId, {
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      limit: 10
    }),
    enabled: addOpen && canManageCollaborators && debouncedSearch.length >= 2
  });
  const participantIds = useMemo(() => new Set(participants.map((participant) => participant.userId)), [participants]);
  const candidates = (candidatesQuery.data?.data ?? []).filter((candidate) => !participantIds.has(candidate.userId));
  const selectedCandidate = candidates.find((candidate) => candidate.userId === selectedUserId) ?? null;
  const operationDetails = errorMessage(operationError);

  const updateParticipantsCache = (update: (current: MarketingOpsParticipant[]) => MarketingOpsParticipant[]) => {
    queryClient.setQueryData<MarketingOpsResult<MarketingOpsParticipant[]>>(
      marketingOpsKeys.participants(campaignId),
      (current) => current ? { ...current, data: update(current.data) } : current
    );
  };

  const finishMutation = (version: number) => {
    onCampaignVersionChange(version);
    void queryClient.invalidateQueries({ queryKey: marketingOpsKeys.timeline(campaignId) });
    void queryClient.invalidateQueries({ queryKey: marketingOpsKeys.campaigns() });
  };

  const addParticipant = async () => {
    if (!selectedCandidate || pendingKey || !canManageCollaborators) return;
    const safeRole = canManageOwners ? newRole : collaboratorRoles.includes(newRole) ? newRole : 'editor';
    setPendingKey(`add:${selectedCandidate.userId}`);
    setOperationError(null);
    try {
      const response = await client.addParticipant(
        campaignId,
        campaignVersion,
        {
          userId: selectedCandidate.userId,
          memberRole: safeRole,
          ...(canManageOwners && safeRole === 'owner' && newPrimary ? { isPrimary: true } : {})
        },
        idempotencyKey()
      );
      updateParticipantsCache((current) => {
        const normalized = response.data.participant.isPrimary
          ? current.map((participant) => participant.isPrimary ? { ...participant, isPrimary: false } : participant)
          : current;
        return [
          ...normalized.filter((participant) => participant.userId !== response.data.participant.userId),
          response.data.participant
        ];
      });
      finishMutation(response.data.campaignVersion);
      setAddOpen(false);
      setCandidateSearch('');
      setDebouncedSearch('');
      setSelectedUserId(null);
      setNewRole('editor');
      setNewPrimary(false);
    } catch (error) {
      setOperationError(error);
    } finally {
      setPendingKey(null);
    }
  };

  const updateParticipant = async (
    participant: MarketingOpsParticipant,
    patch: { memberRole?: MarketingOpsParticipantRole; isPrimary?: boolean }
  ) => {
    if (pendingKey) return;
    const canUpdate = canManageOwners || (canManageCollaborators && participant.memberRole !== 'owner');
    if (!canUpdate) return;
    setPendingKey(`update:${participant.userId}`);
    setOperationError(null);
    try {
      const response = await client.updateParticipant(
        campaignId,
        participant.userId,
        campaignVersion,
        patch,
        idempotencyKey()
      );
      updateParticipantsCache((current) => current.map((item) => {
        if (response.data.participant.isPrimary && item.memberRole === 'owner') {
          return item.userId === response.data.participant.userId
            ? response.data.participant
            : { ...item, isPrimary: false };
        }
        return item.userId === response.data.participant.userId ? response.data.participant : item;
      }));
      finishMutation(response.data.campaignVersion);
    } catch (error) {
      setOperationError(error);
    } finally {
      setPendingKey(null);
    }
  };

  const removeParticipant = async () => {
    if (!removeTarget || pendingKey) return;
    const canRemove = !removeTarget.isPrimary && (
      canManageOwners || (canManageCollaborators && removeTarget.memberRole !== 'owner')
    );
    if (!canRemove) return;
    setPendingKey(`remove:${removeTarget.userId}`);
    setOperationError(null);
    try {
      const response = await client.removeParticipant(
        campaignId,
        removeTarget.userId,
        campaignVersion,
        idempotencyKey()
      );
      updateParticipantsCache((current) => current.filter((item) => item.userId !== response.data.removedUserId));
      finishMutation(response.data.campaignVersion);
      setRemoveTarget(null);
    } catch (error) {
      setOperationError(error);
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <section aria-labelledby="campaign-people" className="border-b border-white/40 bg-white/25 px-4 py-6 backdrop-blur-lg sm:px-6 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="campaign-people" className="text-lg font-semibold text-text-primary">Pessoas</h2>
            <p className="mt-1 text-sm text-text-muted">{participants.length} participante{participants.length === 1 ? '' : 's'}</p>
          </div>
          {canManageCollaborators ? (
            <Button type="button" variant="outline" onClick={() => {
              setOperationError(null);
              setAddOpen(true);
            }} className="h-11 rounded-[8px] bg-white/80">
              <Plus className="mr-2 h-4 w-4" />
              Adicionar participante
            </Button>
          ) : null}
        </div>

        {operationError && !addOpen && !removeTarget ? (
          <Alert variant="destructive" className="mt-4 rounded-[8px] border-white/60 bg-white/80 shadow-glass backdrop-blur-xl">
            <AlertTitle>Operação não concluída</AlertTitle>
            <AlertDescription>
              {operationDetails.message}
              {operationDetails.correlationId ? <span className="ml-1 text-xs">Correlação: {operationDetails.correlationId}</span> : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {participantsQuery.isLoading ? (
          <div aria-label="Carregando participantes" className="mt-5 space-y-2">
            <div className="h-16 animate-pulse rounded-[8px] bg-slate-200" />
            <div className="h-16 animate-pulse rounded-[8px] bg-slate-200" />
          </div>
        ) : participantsQuery.isError ? (
          <Alert variant="destructive" className="mt-5 rounded-[8px] border-white/60 bg-white/80 shadow-glass backdrop-blur-xl">
            <AlertTitle>Não foi possível carregar as pessoas</AlertTitle>
            <AlertDescription>
              <Button type="button" variant="outline" onClick={() => participantsQuery.refetch()} className="mt-2 h-10 rounded-[8px]">
                <RefreshCw className="mr-2 h-4 w-4" />
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        ) : participants.length === 0 ? (
          <p className="mt-5 border-l-2 border-slate-300 px-4 py-3 text-sm text-text-muted">Nenhum participante encontrado.</p>
        ) : (
          <ul className="glass-surface shadow-glass mt-5 divide-y divide-white/50 overflow-hidden rounded-[8px] border-white/60">
            {participants.map((participant) => {
              const collaboratorEditable = canManageCollaborators && participant.memberRole !== 'owner';
              const roleEditable = !participant.isPrimary && (canManageOwners || collaboratorEditable);
              const options = canManageOwners ? allRoles : collaboratorEditable ? collaboratorRoles : [participant.memberRole];
              const removable = !participant.isPrimary && (canManageOwners || collaboratorEditable);
              const busy = pendingKey?.endsWith(participant.userId) ?? false;
              return (
                <li key={participant.userId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-10 w-10 shrink-0">
                      {participant.avatarUrl ? <AvatarImage src={participant.avatarUrl} alt="" /> : null}
                      <AvatarFallback>{initials(participant.displayName)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">{participant.displayName}</p>
                      {participant.isPrimary ? (
                        <Badge variant="outline" className="mt-1 rounded-full border-emerald-200 bg-emerald-50 text-emerald-800">
                          Responsável principal
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <select
                      aria-label={`Papel de ${participant.displayName}`}
                      className={selectClass}
                      value={participant.memberRole}
                      disabled={!roleEditable || busy}
                      onChange={(event) => void updateParticipant(participant, {
                        memberRole: event.target.value as MarketingOpsParticipantRole
                      })}
                    >
                      {options.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                    </select>
                    {canManageOwners && participant.memberRole === 'owner' && !participant.isPrimary ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void updateParticipant(participant, { isPrimary: true })}
                        aria-label={`Tornar ${participant.displayName} principal`}
                        className="h-10 rounded-[8px]"
                      >
                        <UserRoundCheck className="mr-2 h-4 w-4" />
                        Tornar principal
                      </Button>
                    ) : null}
                    {removable ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        onClick={() => {
                          setOperationError(null);
                          setRemoveTarget(participant);
                        }}
                        aria-label={`Remover ${participant.displayName}`}
                        className="h-10 w-10 rounded-[8px] text-red-700"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={(open) => {
        if (pendingKey) return;
        setAddOpen(open);
        if (!open) {
          setCandidateSearch('');
          setDebouncedSearch('');
          setSelectedUserId(null);
          setNewRole('editor');
          setNewPrimary(false);
        }
      }}>
        <DialogContent className="rounded-[8px] border-white/60 bg-white/90 text-text-primary shadow-glass backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>Adicionar participante</DialogTitle>
            <DialogDescription>Localize uma pessoa do tenant e defina seu papel na campanha.</DialogDescription>
          </DialogHeader>
          {operationError ? (
            <Alert variant="destructive" className="rounded-[8px]">
              <AlertTitle>Operação não concluída</AlertTitle>
              <AlertDescription>
                {operationDetails.message}
                {operationDetails.correlationId ? <span className="ml-1 text-xs">Correlação: {operationDetails.correlationId}</span> : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="participant-search">Buscar pessoa</Label>
              <Input
                id="participant-search"
                value={candidateSearch}
                onChange={(event) => {
                  setCandidateSearch(event.target.value);
                  setSelectedUserId(null);
                }}
                maxLength={200}
                className="h-11 rounded-[8px]"
              />
            </div>
            {candidatesQuery.isFetching ? <p className="text-sm text-text-muted">Buscando pessoas...</p> : null}
            {candidatesQuery.isError ? <p className="text-sm text-red-700">Não foi possível buscar pessoas.</p> : null}
            {candidates.length ? (
              <div className="divide-y divide-slate-100 rounded-[8px] border border-slate-200">
                {candidates.map((candidate) => (
                  <Button
                    key={candidate.userId}
                    type="button"
                    variant={candidate.userId === selectedUserId ? 'secondary' : 'ghost'}
                    onClick={() => setSelectedUserId(candidate.userId)}
                    aria-label={`Selecionar ${candidate.displayName}`}
                    className="h-auto min-h-11 w-full justify-start rounded-none px-3 py-2"
                  >
                    {candidate.displayName}
                  </Button>
                ))}
              </div>
            ) : null}
            {selectedCandidate ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="participant-new-role">Papel do novo participante</Label>
                  <select
                    id="participant-new-role"
                    className={`${selectClass} w-full`}
                    value={newRole}
                    onChange={(event) => {
                      const role = event.target.value as MarketingOpsParticipantRole;
                      setNewRole(role);
                      if (role !== 'owner') setNewPrimary(false);
                    }}
                  >
                    {(canManageOwners ? allRoles : collaboratorRoles).map((role) => (
                      <option key={role} value={role}>{roleLabels[role]}</option>
                    ))}
                  </select>
                </div>
                {canManageOwners && newRole === 'owner' ? (
                  <label className="flex min-h-11 items-center gap-2 self-end text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={newPrimary}
                      onChange={(event) => setNewPrimary(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Tornar principal
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={Boolean(pendingKey)} onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button type="button" disabled={!selectedCandidate || Boolean(pendingKey)} onClick={() => void addParticipant()}>
              {pendingKey?.startsWith('add:') ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar participante
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(open) => {
        if (!open && !pendingKey) setRemoveTarget(null);
      }}>
        <AlertDialogContent className="rounded-[8px] border-white/60 bg-white/90 text-text-primary shadow-glass backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remover participante</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget ? `${removeTarget.displayName} perderá o acesso concedido por esta campanha.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {operationError ? (
            <Alert variant="destructive" className="rounded-[8px]">
              <AlertTitle>Operação não concluída</AlertTitle>
              <AlertDescription>
                {operationDetails.message}
                {operationDetails.correlationId ? <span className="ml-1 text-xs">Correlação: {operationDetails.correlationId}</span> : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(pendingKey)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={Boolean(pendingKey)} onClick={(event) => {
              event.preventDefault();
              void removeParticipant();
            }}>
              Confirmar remoção
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
