import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { AppRole, getRoleLabel, isAdminRole, normalizeProfileRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sidebar } from "@/components/Sidebar";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { 
  UserPlus, 
  Key, 
  Loader2, 
  Search, 
  Users, 
  ShieldCheck, 
  Mail,
  Trash2,
  Edit,
  Camera,
  Upload
} from "lucide-react";

interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: string;
  avatar_url?: string;
  hermes_enabled?: boolean;
  hermes_base_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

const ROLE_OPTIONS: Array<{ value: AppRole; label: string }> = [
  { value: "member", label: "Membro" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Administrador" },
];

const getRoleBadgeClass = (role: string) => {
  const normalized = normalizeProfileRole(role);
  if (normalized === "admin") return "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border-purple-500/20";
  if (normalized === "manager") return "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border-emerald-500/20";
  return "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border-blue-500/20";
};

const getFunctionErrorMessage = async (error: unknown, fallback: string) => {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json();
      const reason = typeof payload?.reason === "string" ? payload.reason : "";
      const code = typeof payload?.error === "string" ? payload.error : "";
      return [fallback, code, reason].filter(Boolean).join(" - ");
    } catch {
      return `${fallback}: ${error.message}`;
    }
  }

  return fallback;
};

export default function UserManagement() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Create User State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("member");
  const [createLoading, setCreateLoading] = useState(false);

  // Reset Password State
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  // Delete User State
  const [userToDelete, setUserToDelete] = useState<Profile | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Edit User State
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<Profile | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<AppRole>("member");
  const [editHermesEnabled, setEditHermesEnabled] = useState(false);
  const [editHermesBaseUrl, setEditHermesBaseUrl] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    fetchProfiles();
  }, []);

  const fetchProfiles = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");

      if (error) throw error;

      const profileRows = data || [];
      const { data: integrationRows, error: integrationError } = await supabase
        .from("user_chat_integrations")
        .select("user_id, hermes_enabled, hermes_base_url");

      if (integrationError) throw integrationError;

      const integrationMap = new Map(
        (integrationRows || []).map((row) => [
          row.user_id,
          {
            hermes_enabled: row.hermes_enabled,
            hermes_base_url: row.hermes_base_url,
          },
        ]),
      );

      setProfiles(
        profileRows.map((profile) => ({
          ...profile,
          ...(integrationMap.get(profile.id) ?? { hermes_enabled: false, hermes_base_url: null }),
        })),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro ao carregar usuários: " + msg);
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (file: File, userId: string, oldAvatarUrl?: string) => {
    // Se existir avatar antigo, tentar deletar
    if (oldAvatarUrl) {
      try {
        // Extrai o nome do arquivo da URL antiga
        // URL típica: .../storage/v1/object/public/avatars/filename.ext
        const oldFileName = oldAvatarUrl.split('/').pop();
        if (oldFileName) {
          await supabase.storage.from('avatars').remove([oldFileName]);
        }
      } catch (err) {
        console.warn("Falha ao deletar avatar antigo (não crítico):", err);
      }
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForEdit) return;

    try {
      setEditLoading(true);
      let avatarUrl = selectedUserForEdit.avatar_url || null;

      if (editAvatarFile) {
        try {
          // Passa a URL antiga para que seja deletada se o upload for bem-sucedido
          avatarUrl = await handleAvatarUpload(editAvatarFile, selectedUserForEdit.id, selectedUserForEdit.avatar_url);
        } catch (uploadErr: unknown) {
          const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr || "");
          if (msg.includes("Bucket not found")) {
            toast.error("Bucket 'avatars' não encontrado. Crie um bucket público chamado 'avatars' no Supabase Storage.");
          } else {
            toast.error("Falha ao enviar imagem: " + msg);
          }
          return;
        }
      }

      const normalizedHermesBaseUrl = editHermesBaseUrl.trim();
      if (editHermesEnabled) {
        try {
          const parsed = new URL(normalizedHermesBaseUrl);
          if (parsed.protocol !== "https:") {
            throw new Error("A base URL personalizada deve usar HTTPS.");
          }
        } catch (urlError) {
          const message = urlError instanceof Error ? urlError.message : "Informe uma base URL HTTPS valida.";
          toast.error(message);
          return;
        }
      }

      const { error } = await supabase.rpc('admin_update_profile', {
        target_user_id: selectedUserForEdit.id,
        new_full_name: editName,
        new_avatar_url: avatarUrl,
        new_role: editRole,
      });

      if (error) throw error;

      const { error: integrationError, data: integrationRow } = await supabase.rpc(
        "admin_upsert_user_chat_integration",
        {
          target_user_id: selectedUserForEdit.id,
          new_hermes_enabled: editHermesEnabled,
          new_hermes_base_url: editHermesEnabled ? normalizedHermesBaseUrl : null,
        },
      );

      if (integrationError) throw integrationError;

      setProfiles((prev) => prev.map((p) => (
        p.id === selectedUserForEdit.id
          ? {
              ...p,
              full_name: editName,
              avatar_url: avatarUrl || undefined,
              role: editRole,
              hermes_enabled: integrationRow?.hermes_enabled ?? editHermesEnabled,
              hermes_base_url: integrationRow?.hermes_base_url ?? (editHermesEnabled ? normalizedHermesBaseUrl : null),
            }
          : p
      )));

      toast.success("Usuário atualizado com sucesso!");
      setIsEditOpen(false);
      setEditAvatarFile(null);
      setEditAvatarPreview(null);
      setEditRole("member");
      setEditHermesEnabled(false);
      setEditHermesBaseUrl("");
      fetchProfiles();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err || "");
      if (msg.includes("function admin_update_profile") || msg.includes("function admin_upsert_user_chat_integration")) {
        toast.error("Funções RPC administrativas ausentes. Execute as migrations do Supabase antes de usar o painel.");
      } else {
        toast.error("Erro ao atualizar usuário: " + msg);
      }
    } finally {
      setEditLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 2 * 1024 * 1024) {
        toast.error("A imagem deve ter no máximo 2MB");
        return;
      }
      setEditAvatarFile(file);
      setEditAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newName || !newPassword) {
      toast.error("Preencha todos os campos");
      return;
    }

    try {
      setCreateLoading(true);
      const { error } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: newEmail,
          password: newPassword,
          full_name: newName,
          role: newRole,
        },
      });

      if (error) throw error;

      toast.success("Usuário criado com sucesso!");
      setIsCreateOpen(false);
      setNewEmail("");
      setNewName("");
      setNewPassword("");
      setNewRole("member");
      fetchProfiles();
    } catch (err: unknown) {
      console.error("Erro detalhado ao criar usuário:", err);
      const fallback = err instanceof Error ? err.message : JSON.stringify(err);
      const msg = await getFunctionErrorMessage(err, fallback);
      toast.error("Erro ao criar usuário: " + msg);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !resetPassword) return;
    if (resetPassword.length < 8) {
      toast.error("A senha deve ter pelo menos 8 caracteres");
      return;
    }

    try {
      setResetLoading(true);

      const { error } = await supabase.functions.invoke("admin-reset-password", {
        body: {
          user_id: selectedUser.id,
          password: resetPassword,
        },
      });

      if (error) throw error;

      toast.success(`Senha de ${selectedUser.full_name} redefinida com sucesso!`);
      setIsResetOpen(false);
      setSelectedUser(null);
      setResetPassword("");
    } catch (err: unknown) {
      const fallback = err instanceof Error ? err.message : String(err);
      const msg = await getFunctionErrorMessage(err, fallback);
      toast.error("Erro ao redefinir senha: " + msg);
    } finally {
      setResetLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;

    try {
      setDeleteLoading(true);

      const { error } = await supabase.functions.invoke("admin-delete-user", {
        body: {
          user_id: userToDelete.id,
        },
      });

      if (error) throw error;

      toast.success(`Usuário ${userToDelete.full_name} removido com sucesso!`);
      
      setProfiles(profiles.filter(p => p.id !== userToDelete.id));
      setIsDeleteOpen(false);
      setUserToDelete(null);
    } catch (err: unknown) {
      const fallback = err instanceof Error ? err.message : String(err);
      const msg = await getFunctionErrorMessage(err, fallback);
      toast.error("Erro ao deletar usuário: " + msg);
    } finally {
      setDeleteLoading(false);
    }
  };

  const filteredProfiles = profiles.filter(
    (profile) =>
      profile.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      profile.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getInitials = (name: string) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  };

  const getHermesEndpointLabel = (profile: Profile) => {
    if (!profile.hermes_enabled || !profile.hermes_base_url) {
      return "Endpoint Hermes: padrao global";
    }

    try {
      return `Endpoint Hermes: ${new URL(profile.hermes_base_url).host}`;
    } catch {
      return `Endpoint Hermes: ${profile.hermes_base_url}`;
    }
  };

  const stats = {
    total: profiles.length,
    admins: profiles.filter(p => isAdminRole(p.role)).length,
    managers: profiles.filter(p => normalizeProfileRole(p.role) === "manager").length,
    users: profiles.filter(p => normalizeProfileRole(p.role) === "member").length
  };

  return (
    <div className="min-h-screen relative bg-background">
      <Sidebar />
      <div className="ml-0 md:ml-20 p-4 md:p-8 space-y-8 animate-fade-in overflow-y-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Gerenciamento de Usuários</h1>
            <p className="text-muted-foreground mt-2">Administre o acesso e as credenciais da equipe.</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-105">
                <UserPlus className="w-4 h-4 mr-2" />
                Novo Usuário
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-surface border-white/10 text-foreground sm:max-w-[425px]" style={{ backgroundColor: '#ffffff' }}>
              <DialogHeader>
                <DialogTitle>Criar Novo Usuário</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Adicione um novo membro à equipe. Eles receberão acesso imediato.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateUser} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome Completo</Label>
                  <Input
                    id="name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground focus:ring-primary/50"
                    placeholder="Ex: João Silva"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground focus:ring-primary/50"
                    placeholder="joao@ens.edu.br"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Senha Inicial</Label>
                  <Input
                    id="password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground focus:ring-primary/50"
                    placeholder="••••••••"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Papel</Label>
                  <Select value={newRole} onValueChange={(value) => setNewRole(value as AppRole)}>
                    <SelectTrigger id="role" className="bg-white/5 border-white/10 text-foreground focus:ring-primary/50">
                      <SelectValue placeholder="Selecione o papel" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter className="pt-4">
                  <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={createLoading}>
                    {createLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Criar Usuário
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="glass-surface border-white/10 text-foreground">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total de Usuários</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-xs text-muted-foreground">Membros ativos na plataforma</p>
            </CardContent>
          </Card>
          <Card className="glass-surface border-white/10 text-foreground">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Administradores</CardTitle>
              <ShieldCheck className="h-4 w-4 text-purple-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.admins}</div>
              <p className="text-xs text-muted-foreground">Acesso total ao sistema</p>
            </CardContent>
          </Card>
          <Card className="glass-surface border-white/10 text-foreground">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Managers</CardTitle>
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.managers}</div>
              <p className="text-xs text-muted-foreground">Gestao de trabalhos validados</p>
            </CardContent>
          </Card>
          <Card className="glass-surface border-white/10 text-foreground">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Membros</CardTitle>
              <UserPlus className="h-4 w-4 text-blue-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.users}</div>
              <p className="text-xs text-muted-foreground">Acesso padrão</p>
            </CardContent>
          </Card>
        </div>

        <div className="glass-surface rounded-xl border border-white/10 overflow-hidden shadow-2xl shadow-black/20">
          <div className="p-4 border-b border-white/10 flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome ou e-mail..."
                className="pl-9 bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground focus:bg-white/10 transition-all"
              />
            </div>
            <div className="text-sm text-muted-foreground hidden md:block">
              Mostrando {filteredProfiles.length} resultados
            </div>
          </div>

          {loading ? (
            <div className="p-20 flex flex-col items-center justify-center text-white/40 animate-pulse">
              <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
                          <p className="text-foreground">Carregando equipe...</p>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-white/5">
                    <TableHead className="text-muted-foreground pl-6">Usuário</TableHead>
                    <TableHead className="text-muted-foreground">Função</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-right text-muted-foreground pr-6">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProfiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-[300px] text-center">
                        <div className="flex flex-col items-center justify-center text-muted-foreground space-y-3">
                          <Search className="w-12 h-12 opacity-20" />
                          <p className="text-lg font-medium text-foreground">Nenhum usuário encontrado</p>
                          <p className="text-sm max-w-xs mx-auto">Tente buscar por outro termo ou adicione um novo usuário.</p>
                          <Button 
                            variant="outline" 
                            className="mt-4 border-white/10 hover:bg-white/5"
                            onClick={() => {
                              setSearchTerm("");
                              setIsCreateOpen(true);
                            }}
                          >
                            Limpar busca e criar novo
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredProfiles.map((profile) => (
                      <TableRow key={profile.id} className="border-white/10 hover:bg-white/5 transition-colors group">
                        <TableCell className="pl-6 py-4">
                          <div className="flex items-center gap-4">
                            <Avatar className="h-10 w-10 border-2 border-white/10 group-hover:border-primary/50 transition-colors">
                              <AvatarImage src={profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.email}`} />
                              <AvatarFallback className="bg-primary/20 text-primary font-bold">
                                {getInitials(profile.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                              <span className="font-semibold text-foreground">{profile.full_name}</span>
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Mail className="w-3 h-3" />
                                {profile.email}
                              </span>
                              <span className="text-[11px] text-muted-foreground/80 mt-1">
                                {getHermesEndpointLabel(profile)}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={normalizeProfileRole(profile.role) === "member" ? "secondary" : "default"} className={`
                            capitalize
                            ${getRoleBadgeClass(profile.role)}
                          `}>
                            {getRoleLabel(profile.role)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-sm text-muted-foreground">Ativo</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex items-center justify-end gap-2">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-foreground hover:text-foreground hover:bg-white/10"
                              onClick={() => {
                                setSelectedUserForEdit(profile);
                                setEditName(profile.full_name || "");
                                setEditAvatarPreview(profile.avatar_url || null);
                                setEditRole(normalizeProfileRole(profile.role));
                                setEditHermesEnabled(Boolean(profile.hermes_enabled && profile.hermes_base_url));
                                setEditHermesBaseUrl(profile.hermes_base_url || "");
                                setIsEditOpen(true);
                              }}
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              Editar
                            </Button>

                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-foreground hover:text-foreground hover:bg-white/10"
                              onClick={() => {
                                setSelectedUser(profile);
                                setIsResetOpen(true);
                              }}
                            >
                              <Key className="w-4 h-4 mr-2" />
                              Redefinir Senha
                            </Button>

                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              disabled={profile.id === user?.id}
                              title={profile.id === user?.id ? "Você não pode se excluir" : "Excluir usuário"}
                              onClick={() => {
                                setUserToDelete(profile);
                                setIsDeleteOpen(true);
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      <Dialog open={isResetOpen} onOpenChange={(open) => {
        setIsResetOpen(open);
        if (!open) setSelectedUser(null);
      }}>
        <DialogContent className="glass-surface border-white/10 text-foreground" style={{ backgroundColor: '#ffffff' }}>
          <DialogHeader>
            <DialogTitle>Redefinir Senha</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleResetPassword} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="new-pass">Nova Senha</Label>
              <Input
                id="new-pass"
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground focus:ring-primary/50"
                placeholder="••••••••"
              />
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={resetLoading}>
                {resetLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Salvar Nova Senha
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={isEditOpen} onOpenChange={(open) => {
        setIsEditOpen(open);
        if (!open) {
          setSelectedUserForEdit(null);
          setEditAvatarFile(null);
          setEditAvatarPreview(null);
          setEditRole("member");
          setEditHermesEnabled(false);
          setEditHermesBaseUrl("");
        }
      }}>
        <DialogContent className="glass-surface border-white/10 text-foreground sm:max-w-[425px]" style={{ backgroundColor: '#ffffff' }}>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Atualize as informações do perfil do usuário.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateUser} className="space-y-6 mt-4">
            <div className="flex flex-col items-center gap-4">
              <div className="relative group cursor-pointer">
                <Avatar className="h-24 w-24 border-2 border-white/20 group-hover:border-primary/50 transition-all">
                  <AvatarImage src={editAvatarPreview || (selectedUserForEdit?.email ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedUserForEdit.email}` : "")} />
                  <AvatarFallback className="text-2xl">
                    {getInitials(editName)}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="w-8 h-8 text-white" />
                </div>
                <Input
                  id="edit-avatar-upload"
                  name="edit-avatar-upload"
                  type="file"
                  accept="image/*"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={handleFileChange}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Sugerido: 400x400px, Máx 2MB.<br/>Clique na imagem para alterar.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-name">Nome Completo</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground focus:ring-primary/50"
                placeholder="Ex: João Silva"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-role">Papel</Label>
              <Select value={editRole} onValueChange={(value) => setEditRole(value as AppRole)}>
                <SelectTrigger id="edit-role" className="bg-white/5 border-white/10 text-foreground focus:ring-primary/50">
                  <SelectValue placeholder="Selecione o papel" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="edit-hermes-enabled">Endpoint Hermes personalizado</Label>
                  <p className="text-xs text-muted-foreground">
                    Quando desligado, o usuario usa automaticamente a base URL global configurada no servidor.
                  </p>
                </div>
                <Switch
                  id="edit-hermes-enabled"
                  checked={editHermesEnabled}
                  onCheckedChange={setEditHermesEnabled}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-hermes-base-url">Base URL Hermes</Label>
                <Input
                  id="edit-hermes-base-url"
                  value={editHermesBaseUrl}
                  onChange={(e) => setEditHermesBaseUrl(e.target.value)}
                  placeholder="https://api-hermes.exemplo.com"
                  disabled={!editHermesEnabled}
                  className="bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground focus:ring-primary/50"
                />
                <p className="text-xs text-muted-foreground">
                  Salve em branco apenas se o endpoint personalizado estiver desligado.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={editLoading}>
                {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                Salvar Alterações
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={(open) => {
        setIsDeleteOpen(open);
        if (!open) setUserToDelete(null);
      }}>
        <DialogContent className="glass-surface border-white/10 text-foreground sm:max-w-[425px]" style={{ backgroundColor: '#ffffff' }}>
          <DialogHeader>
            <DialogTitle className="text-red-500 flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              Confirmar Exclusão
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-2">
              Tem certeza que deseja excluir o usuário <strong>{userToDelete?.full_name}</strong>?
              <br /><br />
              <span className="text-red-400 bg-red-500/10 p-2 rounded block text-xs">
                Esta ação removerá permanentemente o acesso e todos os dados associados. Não pode ser desfeita.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              onClick={() => setIsDeleteOpen(false)}
              disabled={deleteLoading}
            >
              Cancelar
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDeleteUser} 
              disabled={deleteLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Excluir Permanentemente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
