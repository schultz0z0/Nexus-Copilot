import { MessageSquare, Image, Settings, LogOut, Camera, Key, Loader2, ClipboardCheck, Megaphone, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { marketingOpsFlags } from "@/lib/marketingOps/flags";

interface SidebarProps {
  activeTab?: "chat" | "image";
  onTabChange?: (tab: "chat" | "image") => void;
  isMobile?: boolean;
  onMobileClose?: () => void;
}

export const Sidebar = ({ activeTab, onTabChange, isMobile, onMobileClose }: SidebarProps) => {
  const { isAdmin, canManageValidatedWorks, signOut, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const marketingOps = marketingOpsFlags(import.meta.env);

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const record = err as Record<string, unknown>;
      if (typeof record.message === "string") return record.message;
    }
    return String(err);
  };

  const handleNavigation = (tab: "chat" | "image") => {
    if (location.pathname === "/") {
      onTabChange?.(tab);
    }

    navigate("/", { state: { tab }, replace: location.pathname === "/" });
    onMobileClose?.();
  };

  const isActive = (tab: "chat" | "image") => {
    if (location.pathname === "/") {
      return activeTab === tab;
    }
    return false;
  };

  const userId = user?.id;

  useEffect(() => {
    const loadProfile = async () => {
      if (!userId) return;
      try {
        setProfileLoading(true);
        const { data, error } = await supabase
          .from("profiles")
          .select("full_name, avatar_url")
          .eq("id", userId)
          .single();
        if (error) throw error;
        setFullName(data?.full_name || "");
        setAvatarUrl(data?.avatar_url || null);
        setAvatarPreview(data?.avatar_url || null);
      } catch (err: unknown) {
        toast.error("Falha ao carregar perfil: " + getErrorMessage(err));
      } finally {
        setProfileLoading(false);
      }
    };
    loadProfile();
  }, [userId]);

  const handleAvatarUpload = async (file: File, userId: string, oldAvatarUrl?: string) => {
    if (oldAvatarUrl) {
      try {
        const oldFileName = oldAvatarUrl.split("/").pop();
        if (oldFileName) {
          await supabase.storage.from("avatars").remove([oldFileName]);
        }
      } catch (e) {
        void e;
      }
    }
    const fileExt = file.name.split(".").pop();
    const fileName = `${userId}-${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(fileName, file, { upsert: true });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from("avatars").getPublicUrl(fileName);
    return data.publicUrl;
  };

  const handleSaveProfile = async () => {
    try {
      setProfileLoading(true);
      let nextAvatarUrl = avatarUrl;
      if (avatarFile) {
        try {
          nextAvatarUrl = await handleAvatarUpload(avatarFile, user.id, avatarUrl || undefined);
        } catch (uploadErr: unknown) {
          const msg = getErrorMessage(uploadErr);
          if (msg.includes("Bucket not found")) {
            toast.error("Bucket 'avatars' não encontrado. Crie um bucket público chamado 'avatars' no Supabase Storage.");
          } else {
            toast.error("Falha ao enviar imagem: " + msg);
          }
          return;
        }
      }
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName || null, avatar_url: nextAvatarUrl || null })
        .eq("id", user.id);
      if (error) throw error;
      setAvatarUrl(nextAvatarUrl || null);
      setAvatarPreview(nextAvatarUrl || null);
      setAvatarFile(null);
      toast.success("Perfil atualizado!");
      setIsProfileOpen(false);
    } catch (err: unknown) {
      toast.error("Erro ao salvar perfil: " + getErrorMessage(err));
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 8) {
      toast.error("A senha deve ter pelo menos 8 caracteres");
      return;
    }
    try {
      setProfileLoading(true);
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Senha alterada com sucesso!");
      setNewPassword("");
    } catch (err: unknown) {
      toast.error("Erro ao alterar senha: " + getErrorMessage(err));
    } finally {
      setProfileLoading(false);
    }
  };

  if (!user) return null;

  return (
    <aside className={cn(
      "glass-sidebar border-r border-white/10 flex flex-col items-center py-6 gap-4 z-50",
      isMobile ? "h-full w-full bg-transparent border-none pointer-events-auto" : "fixed left-0 top-0 h-screen w-20 hidden md:flex"
    )}>
      <Button
        variant="ghost"
        size="icon"
        className="w-12 h-12 rounded-full glass-surface shadow-glass hover:scale-105 transition-transform"
        onClick={() => { navigate("/"); onMobileClose?.(); }}
        aria-label="Ir para a página inicial"
      >
        <img src="/logo.svg" alt="Logo" className="w-10 h-10" />
      </Button>

      <div className="flex-1 flex flex-col gap-4 mt-8">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "w-12 h-12 rounded-full glass-surface shadow-glass hover:scale-105 transition-transform",
            isActive("chat") && "bg-brand-primary/20 text-brand-primary"
          )}
          onClick={() => handleNavigation("chat")}
          aria-label="Abrir chatbot"
          title="Chatbot"
        >
          <MessageSquare className="w-5 h-5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "w-12 h-12 rounded-full glass-surface shadow-glass hover:scale-105 transition-transform",
            isActive("image") && "bg-brand-primary/20 text-brand-primary"
          )}
          onClick={() => handleNavigation("image")}
          aria-label="Abrir gerador de imagens"
          title="Gerar Imagens"
        >
          <Image className="w-5 h-5" />
        </Button>

        {marketingOps.read ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "w-12 h-12 rounded-full glass-surface shadow-glass hover:scale-105 transition-transform",
                location.pathname.startsWith("/marketing-ops/campaigns") && "bg-brand-primary/20 text-brand-primary"
              )}
              onClick={() => { navigate("/marketing-ops/campaigns"); onMobileClose?.(); }}
              aria-label="Abrir campanhas"
              title="Campanhas"
            >
              <Megaphone className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "w-12 h-12 rounded-full glass-surface shadow-glass hover:scale-105 transition-transform",
                location.pathname.startsWith("/marketing-ops/production") && "bg-brand-primary/20 text-brand-primary"
              )}
              onClick={() => { navigate("/marketing-ops/production"); onMobileClose?.(); }}
              aria-label="Abrir esteira de produção"
              title="Produção"
            >
              <CalendarRange className="w-5 h-5" />
            </Button>
            {marketingOps.approvals ? (
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "w-12 h-12 rounded-full glass-surface shadow-glass hover:scale-105 transition-transform",
                  location.pathname.startsWith("/marketing-ops/approvals") && "bg-brand-primary/20 text-brand-primary"
                )}
                onClick={() => { navigate("/marketing-ops/approvals"); onMobileClose?.(); }}
                aria-label="Abrir aprovações de negócio"
                title="Aprovações"
              >
                <ClipboardCheck className="w-5 h-5" />
              </Button>
            ) : null}
          </>
        ) : null}

        {canManageValidatedWorks && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "w-12 h-12 rounded-full glass-surface shadow-glass hover:scale-105 transition-transform",
              location.pathname === "/manager/validated-works" && "bg-brand-primary/20 text-brand-primary"
            )}
            onClick={() => { navigate("/manager/validated-works"); onMobileClose?.(); }}
            aria-label="Abrir trabalhos validados"
            title="Trabalhos Validados"
          >
            <ClipboardCheck className="w-5 h-5" />
          </Button>
        )}

        {/* Admin Only Link */}
        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "w-12 h-12 rounded-full glass-surface shadow-glass hover:scale-105 transition-transform",
              location.pathname.includes("/admin") && "bg-brand-primary/20 text-brand-primary"
            )}
            onClick={() => { navigate("/admin/users"); onMobileClose?.(); }}
            aria-label="Abrir administração de usuários"
            title="Administração"
          >
            <Settings className="w-5 h-5" />
          </Button>
        )}
      </div>

      <Dialog open={isProfileOpen} onOpenChange={setIsProfileOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="w-12 h-12 rounded-full glass-surface shadow-glass hover:scale-105 transition-transform p-0"
            aria-label="Abrir perfil"
            title="Perfil"
          >
            <Avatar className="h-10 w-10">
              <AvatarImage src={avatarPreview || undefined} className="object-cover" />
              <AvatarFallback>{(fullName || user.email || "U").slice(0,1).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-white text-slate-900 border-slate-200 sm:max-w-[480px] z-[60]">
          <DialogHeader>
            <DialogTitle>Configurações de Perfil</DialogTitle>
            <DialogDescription className="text-slate-500">Gerencie sua foto, nome e senha.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-6">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-slate-100">
                <AvatarImage src={avatarPreview || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary font-bold">
                  {(fullName || user.email || "U").slice(0,2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <Label htmlFor="avatar">Foto de perfil</Label>
                <div className="mt-2 flex items-center gap-2">
                  <Input id="avatar" type="file" accept="image/*" className="text-slate-600 file:text-primary" onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      const file = e.target.files[0];
                      if (file.size > 2 * 1024 * 1024) {
                        toast.error("A imagem deve ter no máximo 2MB");
                        return;
                      }
                      setAvatarFile(file);
                      setAvatarPreview(URL.createObjectURL(file));
                    }
                  }} />
                  <Button variant="outline" size="sm" className="border-slate-200 text-slate-700 hover:bg-slate-50">
                    <Camera className="w-4 h-4 mr-2" />Trocar
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fullName">Nome de usuário</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" className="bg-white border-slate-200 text-slate-900 focus-visible:ring-primary" />
            </div>

            <form onSubmit={handleChangePassword} className="space-y-2">
              <Label htmlFor="newPassword">Trocar senha</Label>
              <Input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nova senha" className="bg-white border-slate-200 text-slate-900 focus-visible:ring-primary" />
              <Button type="submit" variant="outline" className="w-full border-slate-200 text-slate-700 hover:bg-slate-50">
                <Key className="w-4 h-4 mr-2" /> Atualizar senha
              </Button>
            </form>

            <div className="relative mt-6 flex items-end gap-2 px-4">
              <img src="/mascot.svg" width={80} height={100} alt="Mascote" className="drop-shadow-lg" />
              <div className="relative -top-12 bg-white rounded-2xl rounded-bl-none px-4 py-3 text-sm text-slate-700 shadow-md border border-slate-100 animate-in fade-in slide-in-from-bottom-2 duration-500">
                Olá, <span className="font-semibold text-primary">{fullName || user.email?.split('@')[0]}</span>!
                <div className="absolute -bottom-[8px] left-0 w-4 h-4 bg-white border-b border-r border-slate-100 transform rotate-45 skew-x-12 shadow-[2px_2px_2px_-1px_rgba(0,0,0,0.05)]"></div>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button onClick={handleSaveProfile} className="w-full bg-primary hover:bg-primary/90" disabled={profileLoading}>
              {profileLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Salvar alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button
        variant="ghost"
        size="icon"
        className="w-12 h-12 rounded-full glass-surface shadow-glass hover:scale-105 transition-transform text-red-400 hover:text-red-300 hover:bg-red-500/10"
        onClick={async () => {
          await signOut();
          navigate("/login");
        }}
        aria-label="Sair da conta"
        title="Sair"
      >
        <LogOut className="w-5 h-5" />
      </Button>
    </aside>
  );
};
