import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Database,
  FileText,
  Filter,
  Layers3,
  Loader2,
  Menu,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  UserRound,
} from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { ValidatedVisualWorkCard } from "@/components/validated-works/ValidatedVisualWorkCard";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { chatService } from "@/lib/chatService";
import {
  getValidatedWorkStatusLabel,
  getValidatedWorkTypeLabel,
  parseTagsInput,
  VALIDATED_WORK_TYPES,
  ValidatedWork,
  ValidatedWorkStatus,
  ValidatedWorkType,
} from "@/lib/validatedWorks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type TypeFilter = "all" | ValidatedWorkType;
type StatusFilter = "all" | ValidatedWorkStatus;

const statusBadgeClass: Record<ValidatedWorkStatus, string> = {
  draft: "border-amber-300/70 bg-amber-100/80 text-amber-800",
  validated: "border-emerald-300/70 bg-emerald-100/80 text-emerald-800",
  deprecated: "border-slate-300/70 bg-slate-100/80 text-slate-700",
};

const statusDotClass: Record<ValidatedWorkStatus, string> = {
  draft: "bg-amber-500",
  validated: "bg-emerald-500",
  deprecated: "bg-slate-400",
};

const statusRailClass: Record<ValidatedWorkStatus, string> = {
  draft: "bg-amber-400",
  validated: "bg-brand-primary",
  deprecated: "bg-slate-300",
};

const typeBadgeClass: Record<ValidatedWorkType, string> = {
  copy: "border-cyan-200 bg-cyan-50 text-cyan-700",
  campanha: "border-violet-200 bg-violet-50 text-violet-700",
  briefing: "border-sky-200 bg-sky-50 text-sky-700",
  insight: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  decisao: "border-emerald-200 bg-emerald-50 text-emerald-700",
  prompt: "border-indigo-200 bg-indigo-50 text-indigo-700",
  estrategia: "border-orange-200 bg-orange-50 text-orange-700",
  peca_visual: "border-cyan-200 bg-cyan-50 text-cyan-700",
};

const formatDate = (value?: string | null) => {
  if (!value) return "sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data invalida";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const getPrimaryDate = (work: ValidatedWork) =>
  work.validated_at ?? work.updated_at ?? work.created_at ?? null;

export default function ValidatedWorksPage() {
  const { user, profile, session } = useAuth();
  const [works, setWorks] = useState<ValidatedWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<ValidatedWork | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formStatus, setFormStatus] = useState<ValidatedWorkStatus>("validated");
  const [formCourseTitle, setFormCourseTitle] = useState("");
  const [formTags, setFormTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const loadWorks = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("validated_works")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(250);
      if (error) throw error;
      setWorks((data ?? []) as ValidatedWork[]);
    } catch (error: unknown) {
      toast.error("Erro ao carregar trabalhos validados: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorks();
  }, []);

  const filteredWorks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return works.filter((work) => {
      if (typeFilter !== "all" && work.artifact_type !== typeFilter) return false;
      if (statusFilter !== "all" && work.status !== statusFilter) return false;
      if (!query) return true;
      return [
        work.title,
        work.content,
        work.related_course_title,
        work.created_by_name,
        work.validated_by_name,
        ...(work.tags ?? []),
      ].join("\n").toLowerCase().includes(query);
    });
  }, [works, searchTerm, typeFilter, statusFilter]);

  const stats = useMemo(() => {
    const validated = works.filter((work) => work.status === "validated").length;
    const draft = works.filter((work) => work.status === "draft").length;
    const deprecated = works.filter((work) => work.status === "deprecated").length;
    const withCourse = works.filter((work) => Boolean(work.related_course_title)).length;

    return [
      {
        label: "Itens carregados",
        value: works.length,
        description: "na memoria",
        icon: Database,
        className: "from-white/80 to-cyan-50/70 text-brand-primary",
      },
      {
        label: "Validados",
        value: validated,
        description: "prontos para consulta",
        icon: ShieldCheck,
        className: "from-white/80 to-emerald-50/70 text-emerald-600",
      },
      {
        label: "Em revisao",
        value: draft,
        description: "rascunhos ativos",
        icon: Clock3,
        className: "from-white/80 to-amber-50/70 text-amber-600",
      },
      {
        label: "Com contexto",
        value: withCourse,
        description: `${deprecated} arquivados`,
        icon: Layers3,
        className: "from-white/80 to-indigo-50/70 text-indigo-600",
      },
    ];
  }, [works]);

  const filterLabels = useMemo(() => {
    const labels: string[] = [];
    if (typeFilter !== "all") labels.push(getValidatedWorkTypeLabel(typeFilter));
    if (statusFilter !== "all") labels.push(getValidatedWorkStatusLabel(statusFilter));
    if (searchTerm.trim()) labels.push("Busca ativa");
    return labels;
  }, [searchTerm, statusFilter, typeFilter]);

  const openEdit = (work: ValidatedWork) => {
    setEditing(work);
    setFormTitle(work.title);
    setFormContent(work.content);
    setFormStatus(work.status);
    setFormCourseTitle(work.related_course_title ?? "");
    setFormTags((work.tags ?? []).join(", "));
  };

  const closeEdit = () => {
    setEditing(null);
    setFormTitle("");
    setFormContent("");
    setFormStatus("validated");
    setFormCourseTitle("");
    setFormTags("");
  };

  const saveEdit = async () => {
    if (!editing) return;
    const visualWork = editing.artifact_type === "peca_visual";
    if (!formTitle.trim() || (!visualWork && !formContent.trim())) {
      toast.error(visualWork ? "Titulo e obrigatorio." : "Titulo e conteudo sao obrigatorios.");
      return;
    }
    try {
      setSaving(true);
      const now = new Date().toISOString();
      const becameValidated = editing.status !== "validated" && formStatus === "validated";
      const payload: Partial<ValidatedWork> = {
        title: formTitle.trim(),
        status: formStatus,
        related_course_title: formCourseTitle.trim() || null,
        tags: parseTagsInput(formTags),
        ...(!visualWork ? { content: formContent.trim() } : {}),
      };
      if (becameValidated) {
        payload.validated_at = now;
        payload.validated_by_user_id = user?.id ?? null;
        payload.validated_by_name = profile?.full_name || profile?.email || "Usuario ENS";
      }

      const { error } = await supabase
        .from("validated_works")
        .update(payload)
        .eq("id", editing.id);
      if (error) throw error;
      toast.success("Trabalho validado atualizado.");
      closeEdit();
      loadWorks();
    } catch (error: unknown) {
      toast.error("Erro ao salvar: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const archiveWork = async (work: ValidatedWork) => {
    try {
      setSaving(true);
      const { error } = await supabase
        .from("validated_works")
        .update({
          status: "deprecated",
          deprecated_by_user_id: user?.id ?? null,
          deprecated_at: new Date().toISOString(),
          metadata: {
            ...(work.metadata ?? {}),
            deprecated_by_name: profile?.full_name || profile?.email || "Usuario ENS",
          },
        })
        .eq("id", work.id);
      if (error) throw error;
      toast.success("Trabalho arquivado.");
      loadWorks();
    } catch (error: unknown) {
      toast.error("Erro ao arquivar: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <Sidebar />

      <div className="sticky top-0 z-50 flex items-center justify-between border-b border-white/40 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-xl md:hidden">
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full glass-surface shadow-glass"
              aria-label="Abrir menu"
              title="Menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="z-[70] w-20 border-none bg-transparent p-0 shadow-none">
            <SheetTitle className="sr-only">Menu de Navegacao</SheetTitle>
            <Sidebar isMobile onMobileClose={() => setIsMobileMenuOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2 rounded-full bg-white/70 px-3 py-2 text-sm font-semibold text-text-primary shadow-sm">
          <ClipboardCheck className="h-4 w-4 text-brand-primary" />
          Trabalhos
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={loadWorks}
          disabled={loading}
          className="h-10 w-10 rounded-full glass-surface shadow-glass"
          aria-label="Atualizar trabalhos"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      <main className="ml-0 min-h-screen px-4 pb-8 pt-4 sm:px-6 md:ml-20 md:px-8 md:py-8 lg:px-10">
        <section className="mx-auto flex w-full max-w-[1760px] flex-col gap-5 md:gap-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-4xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-primary shadow-sm backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                Memoria ENS
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-text-primary sm:text-4xl lg:text-5xl">
                  Trabalhos Validados
                </h1>
                <p className="max-w-3xl text-sm leading-relaxed text-text-secondary sm:text-base">
                  Gerencie a base compartilhada de copy, campanhas, briefings, insights, decisoes, prompts e estrategias que o Hermes consulta.
                </p>
              </div>
            </div>

            <div className="hidden items-center gap-2 md:flex">
              <Badge variant="outline" className="border-white/60 bg-white/60 px-3 py-1.5 text-text-secondary">
                {filteredWorks.length} de {works.length} exibidos
              </Badge>
              <Button variant="outline" onClick={loadWorks} disabled={loading} className="rounded-xl border-white/60 bg-white/70 shadow-sm">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Atualizar
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <div
                  key={stat.label}
                  className="glass-surface shadow-glass rounded-2xl border-white/50 bg-gradient-to-br p-3 sm:p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">{stat.label}</p>
                      <p className="mt-2 text-2xl font-bold leading-none text-text-primary sm:text-3xl">{stat.value}</p>
                      <p className="mt-1 text-xs text-text-secondary">{stat.description}</p>
                    </div>
                    <div className={`rounded-2xl bg-gradient-to-br p-2.5 shadow-sm ${stat.className}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="glass-surface shadow-glass rounded-2xl border-white/50 p-3 sm:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por titulo, curso, autor, validador ou conteudo..."
                  className="h-12 rounded-xl border-white/60 bg-white/70 pl-10 text-sm shadow-sm focus-visible:ring-brand-primary"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[440px]">
                <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}>
                  <SelectTrigger className="h-12 rounded-xl border-white/60 bg-white/70 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-brand-primary" />
                      <SelectValue placeholder="Tipo" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    {VALIDATED_WORK_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{getValidatedWorkTypeLabel(type)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                  <SelectTrigger className="h-12 rounded-xl border-white/60 bg-white/70 shadow-sm">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-brand-primary" />
                      <SelectValue placeholder="Status" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os status</SelectItem>
                    <SelectItem value="validated">Validados</SelectItem>
                    <SelectItem value="draft">Rascunhos</SelectItem>
                    <SelectItem value="deprecated">Arquivados</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <Badge variant="outline" className="border-white/60 bg-white/60 text-text-secondary md:hidden">
                {filteredWorks.length} de {works.length} exibidos
              </Badge>
              {filterLabels.length > 0 ? (
                filterLabels.map((label) => (
                  <Badge key={label} variant="outline" className="border-brand-primary/20 bg-brand-primary/10 text-brand-primary">
                    {label}
                  </Badge>
                ))
              ) : (
                <span className="px-1">Sem filtros ativos.</span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="glass-surface shadow-glass h-64 animate-pulse rounded-2xl border-white/50 bg-white/50 p-4">
                  <div className="h-4 w-32 rounded-full bg-slate-200/70" />
                  <div className="mt-5 h-5 w-4/5 rounded-full bg-slate-200/70" />
                  <div className="mt-4 space-y-2">
                    <div className="h-3 rounded-full bg-slate-200/60" />
                    <div className="h-3 w-11/12 rounded-full bg-slate-200/60" />
                    <div className="h-3 w-8/12 rounded-full bg-slate-200/60" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredWorks.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {filteredWorks.map((work) => work.artifact_type === "peca_visual" ? (
                <ValidatedVisualWorkCard
                  key={work.id}
                  work={work}
                  bridgeBaseUrl={chatService.resolveChatbotProxyBaseUrl() ?? ""}
                  accessToken={session?.access_token ?? ""}
                  actions={(
                    <div className="flex gap-1">
                      <Button variant="outline" size="icon" onClick={() => openEdit(work)} aria-label={`Editar ${work.title}`}><Pencil className="h-4 w-4" /></Button>
                      {work.status !== "deprecated" && <Button variant="destructive" size="icon" onClick={() => archiveWork(work)} disabled={saving} aria-label={`Arquivar ${work.title}`}><Archive className="h-4 w-4" /></Button>}
                    </div>
                  )}
                />
              ) : (
                <article
                  key={work.id}
                  className="group relative flex min-h-[300px] overflow-hidden rounded-2xl border border-white/60 bg-white/70 p-4 shadow-glass backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-brand-primary/20 hover:bg-white/80 sm:p-5"
                >
                  <div className={`absolute inset-y-0 left-0 w-1 ${statusRailClass[work.status]}`} />
                  <div className="flex w-full flex-col gap-4">
                    <header className="space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={`gap-1.5 border px-2.5 py-1 ${typeBadgeClass[work.artifact_type]}`}>
                            <FileText className="h-3.5 w-3.5" />
                            {getValidatedWorkTypeLabel(work.artifact_type)}
                          </Badge>
                          <Badge variant="outline" className={`gap-1.5 px-2.5 py-1 ${statusBadgeClass[work.status]}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass[work.status]}`} />
                            {getValidatedWorkStatusLabel(work.status)}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-text-muted">
                          <CalendarCheck className="h-3.5 w-3.5" />
                          {formatDate(getPrimaryDate(work))}
                        </div>
                      </div>
                      <h2 className="text-lg font-bold leading-snug text-text-primary sm:text-xl">
                        {work.title}
                      </h2>
                    </header>

                    <div className="rounded-xl border border-white/60 bg-white/50 p-3 sm:p-4">
                      <p className="line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                        {work.content}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {work.related_course_title ? (
                        <Badge variant="outline" className="gap-1.5 border-white/60 bg-white/60 text-text-secondary">
                          <BookOpen className="h-3.5 w-3.5 text-brand-primary" />
                          {work.related_course_title}
                        </Badge>
                      ) : null}
                      {(work.tags ?? []).slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="outline" className="gap-1.5 border-white/60 bg-white/50 text-text-muted">
                          <Tag className="h-3 w-3" />
                          {tag}
                        </Badge>
                      ))}
                    </div>

                    <footer className="mt-auto flex flex-col gap-3 border-t border-white/60 pt-3 sm:flex-row sm:items-end sm:justify-between">
                      <div className="space-y-1 text-xs leading-relaxed text-text-muted">
                        <p className="flex items-center gap-1.5">
                          <UserRound className="h-3.5 w-3.5 text-text-muted" />
                          Autor: <span className="font-medium text-text-secondary">{work.created_by_name || "nao informado"}</span>
                        </p>
                        <p className="flex items-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5 text-brand-primary" />
                          Validador: <span className="font-medium text-text-secondary">{work.validated_by_name || "nao informado"}</span>
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                        <Button variant="outline" size="sm" onClick={() => openEdit(work)} className="rounded-xl border-white/70 bg-white/70 shadow-sm">
                          <Pencil className="mr-2 h-4 w-4" />
                          Editar
                        </Button>
                        {work.status !== "validated" ? (
                          <Button size="sm" onClick={() => openEdit({ ...work, status: "validated" })} className="rounded-xl bg-brand-primary text-white shadow-sm hover:bg-brand-primary/90">
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Validar
                          </Button>
                        ) : null}
                        {work.status !== "deprecated" ? (
                          <Button variant="destructive" size="sm" onClick={() => archiveWork(work)} disabled={saving} className="rounded-xl shadow-sm sm:col-auto">
                            <Archive className="mr-2 h-4 w-4" />
                            Arquivar
                          </Button>
                        ) : null}
                      </div>
                    </footer>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="glass-surface shadow-glass flex min-h-[300px] flex-col items-center justify-center rounded-2xl border-white/50 px-6 py-12 text-center">
              <div className="rounded-2xl bg-brand-primary/10 p-4 text-brand-primary">
                <ClipboardCheck className="h-8 w-8" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-text-primary">Nenhum trabalho encontrado</h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
                Ajuste a busca ou os filtros para localizar outro trecho da memoria validada.
              </p>
            </div>
          )}
        </section>
      </main>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) closeEdit(); }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-white/70 bg-white text-slate-900 shadow-glass sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Editar trabalho validado</DialogTitle>
            <DialogDescription className="text-slate-500">
              Alteracoes aqui afetam a memoria compartilhada que o Hermes consulta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="work-title">Titulo</Label>
              <Input id="work-title" value={formTitle} onChange={(event) => setFormTitle(event.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="work-status">Status</Label>
                <Select value={formStatus} onValueChange={(value) => setFormStatus(value as ValidatedWorkStatus)}>
                  <SelectTrigger id="work-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="validated">Validado</SelectItem>
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="deprecated">Arquivado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="work-course">Curso relacionado</Label>
                <Input id="work-course" value={formCourseTitle} onChange={(event) => setFormCourseTitle(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="work-tags">Tags</Label>
              <Input id="work-tags" value={formTags} onChange={(event) => setFormTags(event.target.value)} placeholder="marketing, gestao, pos" />
            </div>
            {editing?.artifact_type === "peca_visual" ? (
              <div className="rounded-xl border border-cyan-100 bg-cyan-50/70 p-4 text-sm text-cyan-900">
                <p className="font-medium">Arquivo visual protegido</p>
                <p className="mt-1 text-cyan-800">Você pode editar título, status, curso e tags. O artefato aprovado não pode ser trocado manualmente.</p>
                <p className="mt-2 text-xs">{editing.artifact_filename || "arquivo"} · {editing.artifact_width || "?"} × {editing.artifact_height || "?"} px</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="work-content">Conteudo</Label>
                <Textarea
                  id="work-content"
                  value={formContent}
                  onChange={(event) => setFormContent(event.target.value)}
                  className="min-h-[260px]"
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={closeEdit} disabled={saving}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={saving} className="bg-brand-primary text-white hover:bg-brand-primary/90">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}
