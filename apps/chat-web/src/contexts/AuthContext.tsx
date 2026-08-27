import { createContext, useContext, useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { AppRole, canManageValidatedWorks, isAdminRole, normalizeProfileRole } from "@/lib/roles";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  canManageValidatedWorks: boolean;
  normalizedRole: AppRole;
  signOut: () => Promise<void>;
}

type Profile = {
  id: string;
  role: "admin" | "manager" | "member" | "user" | "broker" | "owner" | "tenant";
  full_name?: string | null;
  email?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  avatar_url?: string | null;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  isManager: false,
  canManageValidatedWorks: false,
  normalizedRole: "member",
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        // Apenas busca se o profile atual não corresponder ao usuário da sessão
        if (!profile || profile.id !== session.user.id) {
            fetchProfile(session.user.id);
        }
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []); // Removido profile da dependência para evitar loops

  const fetchProfile = async (userId: string) => {
    try {
      // Tenta buscar o perfil até 3 vezes em caso de falha (ex: criação assíncrona)
      let attempts = 0;
      let data: Profile | null = null;
      let error: unknown = null;

      while (attempts < 3 && !data) {
          const result = await supabase
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .single();
          
          data = result.data;
          error = result.error;

          if (!data) {
              attempts++;
              await new Promise(r => setTimeout(r, 500)); // Espera 500ms
          }
      }

      if (error) {
        console.error("Error fetching profile:", error);
        // Fallback para evitar UI quebrada
        setProfile({ id: userId, role: 'member', full_name: 'Usuário' });
      } else {
        setProfile(data);
      }
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      setProfile(null);
      setUser(null);
      setSession(null);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const normalizedRole = normalizeProfileRole(profile?.role);
  const value = {
    session,
    user,
    profile,
    loading,
    normalizedRole,
    isAdmin: isAdminRole(profile?.role),
    isManager: normalizedRole === "manager",
    canManageValidatedWorks: canManageValidatedWorks(profile?.role),
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
