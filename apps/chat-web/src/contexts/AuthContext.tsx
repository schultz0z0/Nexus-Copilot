import { createContext, useContext, useEffect, useState } from "react";
import { api, onUnauthorized, type User } from "@/lib/api";
import { AppRole, isAdminRole, normalizeProfileRole } from "@/lib/roles";

export type { User };

export interface Session {
  user: User;
  access_token?: string;
}

export type Profile = {
  id: string;
  role: "admin" | "manager" | "member" | "user" | "broker" | "owner" | "tenant";
  full_name?: string | null;
  email?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  avatar_url?: string | null;
};

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  normalizedRole: AppRole;
  signIn: (email: string, password: string) => Promise<{ user: User }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  isManager: false,
  normalizedRole: "member",
  signIn: async () => ({ user: { id: "", email: "" } }),
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setSession(null);
      setProfile(null);
    };
    onUnauthorized(handleUnauthorized);
    return () => {
      onUnauthorized(null);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    api.auth
      .me()
      .then(({ user: currentUser }) => {
        if (!isMounted) return;
        if (currentUser) {
          setUser(currentUser);
          setSession({ user: currentUser });
          setProfile({
            id: currentUser.id,
            role: (currentUser.role as Profile["role"]) || "member",
            full_name: currentUser.full_name,
            email: currentUser.email,
          });
        } else {
          setUser(null);
          setSession(null);
          setProfile(null);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setUser(null);
        setSession(null);
        setProfile(null);
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { user: loggedInUser } = await api.auth.login({ email, password });
    setUser(loggedInUser);
    setSession({ user: loggedInUser });
    setProfile({
      id: loggedInUser.id,
      role: (loggedInUser.role as Profile["role"]) || "member",
      full_name: loggedInUser.full_name,
      email: loggedInUser.email,
    });
    return { user: loggedInUser };
  };

  const signOut = async () => {
    try {
      await api.auth.logout();
    } catch (error) {
      console.error("Error signing out:", error);
    } finally {
      setProfile(null);
      setUser(null);
      setSession(null);
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
    signIn,
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
