import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { OrbLoader } from "@/components/ui/OrbLoader";

const Login = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  // Reset Password States
  const [mode, setMode] = useState<"login" | "requestReset" | "setNewPassword">("login");
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    const hash = window.location.hash || "";
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const type = params.get("type");
    if (type === "recovery") {
      setMode("setNewPassword");
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      toast.success("Login realizado com sucesso!");
      
      // Start futuristic transition
      setIsTransitioning(true);
      
      // Wait for 3 seconds before navigating
      setTimeout(() => {
        navigate("/");
      }, 3000);

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro ao realizar login";
      toast.error(msg);
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === "requestReset") {
        if (!resetEmail) {
          toast.error("Informe seu e-mail");
          return;
        }

        const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
          redirectTo: `${window.location.origin}/login`,
        });
        if (error) throw error;

        toast.success("Enviamos um e-mail com instruções para redefinir sua senha.");
        setMode("login");
        setEmail(resetEmail);
        setPassword("");
        setResetEmail("");
        return;
      }

      if (mode === "setNewPassword") {
        if (!newPassword) {
          toast.error("Informe a nova senha");
          return;
        }

        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;

        await supabase.auth.signOut();
        window.location.hash = "";
        toast.success("Senha atualizada. Faça login com sua nova senha.");
        setMode("login");
        setNewPassword("");
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro ao redefinir senha";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {isTransitioning && <OrbLoader />}
      {/* Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-brand-secondary/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="w-full max-w-md space-y-8 z-10">
        <div className="flex flex-col items-center text-center">
          <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-6 shadow-glass border border-white/10 backdrop-blur-md">
            <img src="/logo.svg" alt="ENS Logo" className="w-16 h-16" />
          </div>
          <h2 className="text-3xl font-bold text-text-primary tracking-tight">Nexus AI</h2>
          <p className="text-text-secondary mt-2">Escola de Negócios e Seguros</p>
        </div>

        <div className="glass-surface p-8 rounded-2xl shadow-glass border border-white/10 backdrop-blur-xl">
          {mode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-white/5 border-white/10 focus:border-brand-primary/50 transition-colors"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Senha</Label>
                  <button
                    type="button"
                    onClick={() => setMode("requestReset")}
                    className="text-xs text-brand-primary hover:underline"
                  >
                    Esqueceu a senha?
                  </button>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-white/5 border-white/10 focus:border-brand-primary/50 transition-colors"
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-brand-primary hover:bg-brand-primary/90 transition-all hover:scale-[1.02] shadow-lg shadow-brand-primary/20"
                disabled={loading}
              >
                {loading ? "Entrando..." : "Entrar"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold text-text-primary">
                  {mode === "requestReset" ? "Redefinir senha" : "Definir nova senha"}
                </h3>
                <p className="text-sm text-text-secondary">
                  {mode === "requestReset"
                    ? "Enviaremos um link de redefinição para seu e-mail."
                    : "Crie uma nova senha para sua conta."}
                </p>
              </div>

              <div className="space-y-3">
                {mode === "requestReset" && (
                  <div className="space-y-2">
                    <Label htmlFor="reset-email">E-mail</Label>
                    <Input
                      id="reset-email"
                      name="reset-email"
                      type="email"
                      autoComplete="email"
                      placeholder="seu@email.com"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      required
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                )}

                {mode === "setNewPassword" && (
                  <div className="space-y-2">
                    <Label htmlFor="new-password">Nova senha</Label>
                    <Input
                      id="new-password"
                      name="new-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <Button
                  type="submit"
                  className="w-full bg-brand-primary hover:bg-brand-primary/90 transition-all"
                  disabled={loading}
                >
                  {loading
                    ? "Processando..."
                    : mode === "requestReset"
                      ? "Enviar link de redefinição"
                      : "Salvar nova senha"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    window.location.hash = "";
                    setMode("login");
                    setNewPassword("");
                  }}
                  className="w-full hover:bg-white/5"
                >
                  Voltar para Login
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
