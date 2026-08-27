import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare, PanelLeftClose, PanelLeftOpen, Trash2, MoreVertical, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { chatService, ChatSession } from "@/lib/chatService";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ChatHistorySidebarProps {
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export const ChatHistorySidebar = ({
  currentSessionId,
  onSelectSession,
  onNewChat,
  isOpen,
  onToggle,
}: ChatHistorySidebarProps) => {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  
  // States for modals
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [sessionToRename, setSessionToRename] = useState<ChatSession | null>(null);
  const [newTitle, setNewTitle] = useState("");

  // Carregar sessões
  const loadSessions = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await chatService.listSessions(user.id);
      setSessions(data.filter((session) => session.session_kind === "normal"));
    } catch (error) {
      console.error("Erro ao carregar histórico:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, [user, currentSessionId]); 

  const handleConfirmDelete = async () => {
    if (!sessionToDelete) return;
    
    try {
      console.log("Deleting session:", sessionToDelete);
      await chatService.deleteSession(sessionToDelete);
      setSessions(prev => prev.filter(s => s.id !== sessionToDelete));
      if (currentSessionId === sessionToDelete) {
        onNewChat();
      }
      toast.success("Conversa removida permanentemente");
    } catch (error) {
      console.error("Error deleting session:", error);
      toast.error("Erro ao remover conversa");
    } finally {
      setSessionToDelete(null);
    }
  };

  const handleConfirmRename = async () => {
    if (!sessionToRename || !newTitle.trim()) return;

    try {
      console.log("Renaming session:", sessionToRename.id, "to", newTitle);
      await chatService.updateSessionTitle(sessionToRename.id, newTitle.trim());
      setSessions(prev => prev.map(s => 
        s.id === sessionToRename.id ? { ...s, title: newTitle.trim() } : s
      ));
      toast.success("Título atualizado");
      setSessionToRename(null);
    } catch (error) {
      console.error("Error renaming session:", error);
      toast.error("Erro ao atualizar título");
    }
  };

  const openRenameDialog = (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation(); // Importante para não disparar o clique do item
    console.log("Open rename dialog for:", session);
    setSessionToRename(session);
    setNewTitle(session.title);
  };

  const openDeleteDialog = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation(); // Importante
    console.log("Open delete dialog for:", sessionId);
    setSessionToDelete(sessionId);
  };

  if (!isOpen) {
    return (
      <div className="fixed left-0 md:left-20 top-24 z-20">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="bg-white/50 backdrop-blur-sm shadow-sm border border-white/20 hover:bg-white/80 transition-all rounded-r-xl rounded-l-none h-10 w-8"
          title="Abrir Histórico"
        >
          <PanelLeftOpen className="w-4 h-4 text-slate-600" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="fixed left-0 md:left-20 top-0 h-screen w-64 glass-sidebar border-r border-white/10 flex flex-col z-40 bg-white/40 backdrop-blur-md transition-all duration-300 shadow-2xl md:shadow-none">
        {/* Header */}
        <div className="p-4 pt-6 border-b border-white/10 flex items-center justify-between">
          <h3 className="font-semibold text-text-primary text-sm">Histórico</h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-8 w-8 text-slate-500 hover:text-slate-700"
            title="Fechar Histórico"
          >
            <PanelLeftClose className="w-4 h-4" />
          </Button>
        </div>

        {/* New Chat Button */}
        <div className="p-4">
          <Button
            onClick={onNewChat}
            className="chat-send-button w-full justify-start gap-2 text-white shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Novo Chat
          </Button>
        </div>

        {/* History List */}
        <ScrollArea className="chat-history-scroll flex-1 px-3 min-w-0">
          <div className="space-y-1 pb-4">
            {loading && sessions.length === 0 ? (
              <div className="text-center py-4 text-xs text-slate-400">Carregando...</div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-8 px-4">
                <p className="text-sm text-slate-500 mb-2">Nenhuma conversa anterior.</p>
                <p className="text-xs text-slate-400">Inicie um novo chat para começar.</p>
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={cn(
                    "group flex items-center justify-between p-2 rounded-lg transition-all text-sm mb-1 w-full max-w-full min-w-0 overflow-hidden",
                    currentSessionId === session.id
                      ? "bg-[rgba(0,157,183,0.14)] text-brand-primary font-medium border border-[rgba(0,157,183,0.24)]"
                      : "hover:bg-white/40 text-slate-600 hover:text-slate-900"
                  )}
                >
                  <div 
                    className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden cursor-pointer py-1"
                    onClick={() => onSelectSession(session.id)}
                  >
                    <MessageSquare className="w-4 h-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{session.title}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {format(new Date(session.updated_at), "d 'de' MMM, HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                  
                  <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-slate-400 hover:text-slate-900 hover:bg-white/50 rounded-full"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-40 bg-white text-slate-900 border-slate-200 shadow-lg dark:bg-slate-950 dark:text-slate-50 dark:border-slate-800"
                      >
                        <DropdownMenuItem onClick={(e) => openRenameDialog(e, session)}>
                          <Pencil className="w-4 h-4 mr-2" />
                          Renomear
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={(e) => openDeleteDialog(e, session.id)}
                          className="text-red-600 focus:text-red-600 focus:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!sessionToDelete} onOpenChange={(open) => !open && setSessionToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Isso excluirá permanentemente o histórico desta conversa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-red-600 hover:bg-red-700">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Dialog */}
      <Dialog open={!!sessionToRename} onOpenChange={(open) => !open && setSessionToRename(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Renomear conversa</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Título</Label>
              <Input
                id="name"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmRename();
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSessionToRename(null)}>Cancelar</Button>
            <Button onClick={handleConfirmRename}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
