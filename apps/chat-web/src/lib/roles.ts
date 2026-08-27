export type AppRole = "admin" | "manager" | "member";
export type LegacyProfileRole = "broker" | "owner" | "tenant" | "user";
export type ProfileRole = AppRole | LegacyProfileRole | string | null | undefined;

export const normalizeProfileRole = (role: ProfileRole): AppRole => {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "admin" || normalized === "broker") return "admin";
  if (normalized === "manager") return "manager";
  return "member";
};

export const isAdminRole = (role: ProfileRole) => normalizeProfileRole(role) === "admin";

export const canManageValidatedWorks = (role: ProfileRole) => {
  const normalized = normalizeProfileRole(role);
  return normalized === "admin" || normalized === "manager";
};

export const getRoleLabel = (role: ProfileRole) => {
  const normalized = normalizeProfileRole(role);
  if (normalized === "admin") return "Administrador";
  if (normalized === "manager") return "Manager";
  return "Membro";
};
