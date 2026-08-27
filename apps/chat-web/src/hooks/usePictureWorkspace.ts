import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { PictureWorkspace, PictureWorkspaceClient } from "@/lib/pictureWorkspace/types";

const currentKey = ["picture", "workspace", "current"] as const;
const detailKey = (workspaceId: string) => ["picture", "workspace", workspaceId, "details"] as const;
const filesKey = (workspaceId: string) => ["picture", "workspace", workspaceId, "files"] as const;

interface UsePictureWorkspaceOptions {
  client: PictureWorkspaceClient;
  pollingMs?: number;
}

const asError = (value: unknown) => value instanceof Error ? value : null;

export const usePictureWorkspace = ({ client, pollingMs = 2_000 }: UsePictureWorkspaceOptions) => {
  const queryClient = useQueryClient();
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const currentQuery = useQuery({
    queryKey: currentKey,
    queryFn: ({ signal }) => client.current(signal),
    staleTime: 30_000,
  });
  const workspaceId = currentQuery.data?.id ?? "";
  const detailsQuery = useQuery({
    queryKey: detailKey(workspaceId),
    queryFn: ({ signal }) => client.details(workspaceId, signal),
    enabled: Boolean(workspaceId),
    refetchInterval: (query) => query.state.data?.status === "generating" ? pollingMs : false,
  });
  const workspace = detailsQuery.data ?? currentQuery.data ?? null;
  const filesQuery = useQuery({
    queryKey: filesKey(workspaceId),
    queryFn: ({ signal }) => client.files(workspaceId, signal),
    enabled: Boolean(workspaceId),
    refetchInterval: workspace?.status === "generating" ? pollingMs : false,
  });

  const updateWorkspace = (next: PictureWorkspace) => {
    queryClient.setQueryData(currentKey, next);
    queryClient.setQueryData(detailKey(next.id), next);
  };

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Workspace Picture ainda não carregou.");
      return client.approve(workspaceId);
    },
    onSuccess: (next) => updateWorkspace(next),
  });
  const newPieceMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Workspace Picture ainda não carregou.");
      return client.newPiece(workspaceId);
    },
    onSuccess: (next) => {
      setSelectedFileId(null);
      updateWorkspace(next);
      queryClient.removeQueries({ queryKey: filesKey(workspaceId), exact: true });
    },
  });

  const refresh = async () => {
    const results = await Promise.allSettled([
      currentQuery.refetch(),
      detailsQuery.refetch(),
      filesQuery.refetch(),
    ]);
    return results;
  };

  const error = asError(currentQuery.error)
    ?? asError(detailsQuery.error)
    ?? asError(filesQuery.error)
    ?? asError(approveMutation.error)
    ?? asError(newPieceMutation.error);

  return {
    workspace,
    files: filesQuery.data ?? [],
    selectedFileId,
    setSelectedFileId,
    isLoading: currentQuery.isPending || (Boolean(workspaceId) && detailsQuery.isPending),
    isFilesLoading: filesQuery.isPending && Boolean(workspaceId),
    isApproving: approveMutation.isPending,
    isCreatingNewPiece: newPieceMutation.isPending,
    error,
    refresh,
    approve: approveMutation.mutateAsync,
    newPiece: newPieceMutation.mutateAsync,
  };
};
