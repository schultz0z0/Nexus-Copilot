export type PictureWorkspaceStatus =
  | "drafting"
  | "generating"
  | "review"
  | "validated"
  | "resetting"
  | "closed"
  | "failed";

export interface PictureWorkspace {
  id: string;
  tenant_id: string;
  user_id: string;
  chat_session_id: string;
  title: string;
  status: PictureWorkspaceStatus;
  active: boolean;
  version: number;
  candidate_artifact_id: string | null;
  validated_artifact_id: string | null;
  validated_work_id: string | null;
  last_job_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PictureWorkspaceFile {
  id: string;
  artifact_id?: string;
  filename: string;
  relative_path: string;
  category: string;
  content_type: string;
  lifecycle: "workspace" | "validated";
  byte_size?: number;
  sha256?: string;
  url?: string;
  expires_at?: string;
  created_at?: string;
}

export interface PictureWorkspaceClient {
  current(signal?: AbortSignal): Promise<PictureWorkspace>;
  details(workspaceId: string, signal?: AbortSignal): Promise<PictureWorkspace>;
  files(workspaceId: string, signal?: AbortSignal): Promise<PictureWorkspaceFile[]>;
  approve(workspaceId: string, signal?: AbortSignal): Promise<PictureWorkspace>;
  newPiece(workspaceId: string, signal?: AbortSignal): Promise<PictureWorkspace>;
  accessFile(artifactId: string, signal?: AbortSignal): Promise<{ url: string; expiresAt: string }>;
}
