import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FilePlus2, Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { ChangeEvent, useState } from 'react';
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
  MarketingOpsMaterial,
  MarketingOpsResult,
  MarketingOpsTenantRole
} from '@/lib/marketingOps/types';

const maxUploadBytes = 25 * 1024 * 1024;
const artifactUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedFiles: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'application/csv'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp']
};

function defaultOpenExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function fileError(file: File): string | null {
  if (file.size > maxUploadBytes) return 'O arquivo excede o máximo de 25 MiB.';
  if (file.size === 0) return 'O arquivo está vazio.';
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  if (!allowedFiles[extension]?.includes(file.type.toLowerCase())) {
    return 'Formato de arquivo não permitido.';
  }
  return null;
}

function safeAccessUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function errorDetails(error: unknown): { message: string; correlationId: string | null } {
  const candidate = error as { message?: unknown; correlationId?: unknown } | null;
  return {
    message: typeof candidate?.message === 'string' ? candidate.message : 'Não foi possível concluir a operação.',
    correlationId: typeof candidate?.correlationId === 'string' ? candidate.correlationId : null
  };
}

interface MaterialsPanelProps {
  campaignId: string;
  campaignVersion: number;
  client: MarketingOpsClient;
  tenantRole: MarketingOpsTenantRole;
  currentUserId: string | null;
  readOnly: boolean;
  idempotencyKey: () => string;
  onCampaignVersionChange: (version: number) => void;
  openExternal?: (url: string) => void;
}

export function MaterialsPanel({
  campaignId,
  campaignVersion,
  client,
  tenantRole,
  currentUserId,
  readOnly,
  idempotencyKey,
  onCampaignVersionChange,
  openExternal = defaultOpenExternal
}: MaterialsPanelProps) {
  const queryClient = useQueryClient();
  const [operationError, setOperationError] = useState<unknown>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [artifactId, setArtifactId] = useState('');
  const [unlinkTarget, setUnlinkTarget] = useState<MarketingOpsMaterial | null>(null);

  const participantsQuery = useQuery({
    queryKey: marketingOpsKeys.participants(campaignId),
    queryFn: () => client.listParticipants(campaignId)
  });
  const materialsQuery = useQuery({
    queryKey: marketingOpsKeys.materials(campaignId),
    queryFn: () => client.listMaterials(campaignId)
  });
  const materials = materialsQuery.data?.data ?? [];
  const currentParticipant = participantsQuery.data?.data.find((participant) => participant.userId === currentUserId);
  const managesTenant = tenantRole === 'manager' || tenantRole === 'admin';
  const canManage = !readOnly && (
    managesTenant || currentParticipant?.memberRole === 'owner' || currentParticipant?.memberRole === 'editor'
  );
  const operation = errorDetails(operationError);

  const updateMaterialsCache = (update: (current: MarketingOpsMaterial[]) => MarketingOpsMaterial[]) => {
    queryClient.setQueryData<MarketingOpsResult<MarketingOpsMaterial[]>>(
      marketingOpsKeys.materials(campaignId),
      (current) => current ? { ...current, data: update(current.data) } : current
    );
  };

  const finishMutation = (version: number) => {
    onCampaignVersionChange(version);
    void queryClient.invalidateQueries({ queryKey: marketingOpsKeys.timeline(campaignId) });
    void queryClient.invalidateQueries({ queryKey: marketingOpsKeys.campaigns() });
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canManage || pendingKey) return;
    const validation = fileError(file);
    setValidationError(validation);
    setOperationError(null);
    if (validation) return;
    setPendingKey('upload');
    try {
      const response = await client.uploadMaterial(campaignId, campaignVersion, file, idempotencyKey());
      updateMaterialsCache((current) => [
        response.data.material,
        ...current.filter((material) => material.id !== response.data.material.id)
      ]);
      finishMutation(response.data.campaignVersion);
    } catch (error) {
      setOperationError(error);
    } finally {
      setPendingKey(null);
    }
  };

  const linkExisting = async () => {
    const normalized = artifactId.trim();
    if (!canManage || pendingKey || !artifactUuidPattern.test(normalized)) return;
    setPendingKey('link');
    setOperationError(null);
    try {
      const response = await client.linkMaterial(campaignId, campaignVersion, normalized, idempotencyKey());
      updateMaterialsCache((current) => [
        response.data.material,
        ...current.filter((material) => material.id !== response.data.material.id)
      ]);
      finishMutation(response.data.campaignVersion);
      setLinkOpen(false);
      setArtifactId('');
    } catch (error) {
      setOperationError(error);
    } finally {
      setPendingKey(null);
    }
  };

  const openMaterial = async (material: MarketingOpsMaterial) => {
    if (pendingKey) return;
    setPendingKey(`open:${material.id}`);
    setOperationError(null);
    try {
      const response = await client.createMaterialAccessLink(campaignId, material.id);
      const url = safeAccessUrl(response.data.url);
      if (!url) throw new Error('O link de acesso retornado é inválido.');
      openExternal(url);
    } catch (error) {
      setOperationError(error);
    } finally {
      setPendingKey(null);
    }
  };

  const unlink = async () => {
    if (!unlinkTarget || !canManage || pendingKey) return;
    setPendingKey(`unlink:${unlinkTarget.id}`);
    setOperationError(null);
    try {
      const response = await client.unlinkMaterial(
        campaignId,
        unlinkTarget.id,
        campaignVersion,
        idempotencyKey()
      );
      updateMaterialsCache((current) => current.filter((material) => material.id !== response.data.materialId));
      finishMutation(response.data.campaignVersion);
      setUnlinkTarget(null);
    } catch (error) {
      setOperationError(error);
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <section aria-labelledby="campaign-materials" className="border-b border-white/50 bg-white/50 px-4 py-6 backdrop-blur-xl sm:px-6 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="campaign-materials" className="text-lg font-semibold text-text-primary">Materiais</h2>
            <p className="mt-1 text-sm text-text-muted">{materials.length} {materials.length === 1 ? 'material' : 'materiais'}</p>
          </div>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Label
                htmlFor="campaign-material-upload"
                className="inline-flex h-11 cursor-pointer items-center rounded-[8px] border border-input bg-white/80 px-4 text-sm font-medium hover:bg-white"
              >
                {pendingKey === 'upload' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-2 h-4 w-4" />}
                {pendingKey === 'upload' ? 'Enviando material...' : 'Adicionar material'}
              </Label>
              <input
                id="campaign-material-upload"
                type="file"
                className="sr-only"
                disabled={Boolean(pendingKey)}
                accept={Object.keys(allowedFiles).join(',')}
                onChange={(event) => void upload(event)}
              />
              <Button type="button" variant="outline" onClick={() => {
                setOperationError(null);
                setLinkOpen(true);
              }} className="h-11 rounded-[8px] bg-white/80">
                <Link2 className="mr-2 h-4 w-4" />
                Vincular existente
              </Button>
            </div>
          ) : null}
        </div>

        {validationError ? <p className="mt-3 text-sm text-red-700">{validationError}</p> : null}
        {operationError && !linkOpen && !unlinkTarget ? (
          <Alert variant="destructive" className="mt-4 rounded-[8px] border-white/60 bg-white/80 shadow-glass backdrop-blur-xl">
            <AlertTitle>Operação não concluída</AlertTitle>
            <AlertDescription>
              {operation.message}
              {operation.correlationId ? <span className="ml-1 text-xs">Correlação: {operation.correlationId}</span> : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {materialsQuery.isLoading ? (
          <div aria-label="Carregando materiais" className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="h-28 animate-pulse rounded-[8px] bg-slate-100" />
            <div className="h-28 animate-pulse rounded-[8px] bg-slate-100" />
          </div>
        ) : materialsQuery.isError ? (
          <Alert variant="destructive" className="mt-5 rounded-[8px] border-white/60 bg-white/80 shadow-glass backdrop-blur-xl">
            <AlertTitle>Não foi possível carregar os materiais</AlertTitle>
            <AlertDescription>
              <Button type="button" variant="outline" onClick={() => materialsQuery.refetch()} className="mt-2 h-10 rounded-[8px]">
                <RefreshCw className="mr-2 h-4 w-4" />
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        ) : materials.length === 0 ? (
          <p className="mt-5 border-l-2 border-slate-300 px-4 py-3 text-sm text-text-muted">Nenhum material vinculado.</p>
        ) : (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {materials.map((material) => {
              const busy = pendingKey?.endsWith(material.id) ?? false;
              return (
                <li key={material.id} className="glass-surface shadow-glass rounded-[8px] border-white/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-text-primary">{material.filename}</p>
                      <p className="mt-1 text-xs text-text-muted">{material.contentType} · {formatBytes(material.sizeBytes)}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 rounded-full">
                      {material.source === 'upload' ? 'Upload' : 'Existente'}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-text-muted">
                    Adicionado por {material.createdBy === currentUserId ? 'você' : `usuário ${material.createdBy.slice(0, 8)}`} em {formatDate(material.createdAt)}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void openMaterial(material)}
                      aria-label={`Abrir ${material.filename}`}
                      className="h-10 rounded-[8px]"
                    >
                      {pendingKey === `open:${material.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
                      Abrir
                    </Button>
                    {canManage ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setOperationError(null);
                          setUnlinkTarget(material);
                        }}
                        aria-label={`Desvincular ${material.filename}`}
                        className="h-10 rounded-[8px] text-red-700"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Desvincular
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={linkOpen} onOpenChange={(open) => {
        if (pendingKey) return;
        setLinkOpen(open);
        if (!open) setArtifactId('');
      }}>
        <DialogContent className="rounded-[8px] border-white/60 bg-white/90 text-text-primary shadow-glass backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>Vincular artefato existente</DialogTitle>
            <DialogDescription>Informe o identificador de um artefato ao qual você possui acesso.</DialogDescription>
          </DialogHeader>
          {operationError ? (
            <Alert variant="destructive" className="rounded-[8px]">
              <AlertTitle>Operação não concluída</AlertTitle>
              <AlertDescription>
                {operation.message}
                {operation.correlationId ? <span className="ml-1 text-xs">Correlação: {operation.correlationId}</span> : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="existing-artifact-id">ID do artefato</Label>
            <Input
              id="existing-artifact-id"
              value={artifactId}
              onChange={(event) => setArtifactId(event.target.value)}
              aria-invalid={Boolean(artifactId) && !artifactUuidPattern.test(artifactId.trim())}
              className="h-11 rounded-[8px]"
            />
            {artifactId && !artifactUuidPattern.test(artifactId.trim()) ? (
              <p className="text-sm text-red-700">Informe um UUID válido.</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={Boolean(pendingKey)} onClick={() => setLinkOpen(false)}>Cancelar</Button>
            <Button type="button" disabled={!artifactUuidPattern.test(artifactId.trim()) || Boolean(pendingKey)} onClick={() => void linkExisting()}>
              {pendingKey === 'link' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar vínculo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(unlinkTarget)} onOpenChange={(open) => {
        if (!open && !pendingKey) setUnlinkTarget(null);
      }}>
        <AlertDialogContent className="rounded-[8px] border-white/60 bg-white/90 text-text-primary shadow-glass backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Desvincular material</AlertDialogTitle>
            <AlertDialogDescription>
              O material sairá desta campanha. O arquivo compartilhado não será excluído automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {operationError ? (
            <Alert variant="destructive" className="rounded-[8px]">
              <AlertTitle>Operação não concluída</AlertTitle>
              <AlertDescription>
                {operation.message}
                {operation.correlationId ? <span className="ml-1 text-xs">Correlação: {operation.correlationId}</span> : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(pendingKey)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={Boolean(pendingKey)} onClick={(event) => {
              event.preventDefault();
              void unlink();
            }}>
              Confirmar desvínculo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
