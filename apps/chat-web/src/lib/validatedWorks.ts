export const VALIDATED_WORK_TYPES = [
  "copy",
  "campanha",
  "briefing",
  "insight",
  "decisao",
  "prompt",
  "estrategia",
  "peca_visual",
] as const;

export type ValidatedWorkType = typeof VALIDATED_WORK_TYPES[number];
export type ValidatedWorkStatus = "draft" | "validated" | "deprecated";

export interface ValidatedWork {
  id: string;
  tenant_id: string;
  artifact_type: ValidatedWorkType;
  title: string;
  content: string;
  status: ValidatedWorkStatus;
  related_course_id?: string | null;
  related_course_title?: string | null;
  related_rag_source_id?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  artifact_id?: string | null;
  artifact_filename?: string | null;
  artifact_mime_type?: string | null;
  artifact_width?: number | null;
  artifact_height?: number | null;
  created_by_user_id?: string | null;
  created_by_name?: string | null;
  validated_by_user_id?: string | null;
  validated_by_name?: string | null;
  validated_at?: string | null;
  deprecated_by_user_id?: string | null;
  deprecated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export const getValidatedWorkTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    copy: "Copy",
    campanha: "Campanha",
    briefing: "Briefing",
    insight: "Insight",
    decisao: "Decisao",
    prompt: "Prompt",
    estrategia: "Estrategia",
    peca_visual: "Peça visual",
  };
  return labels[type] ?? type;
};

export const getValidatedWorkStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    draft: "Rascunho",
    validated: "Validado",
    deprecated: "Arquivado",
  };
  return labels[status] ?? status;
};

export const parseTagsInput = (value: string) =>
  value
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
