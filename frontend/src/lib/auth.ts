import { getApiClient } from "../api/client.js";

export interface AuthUser {
  id: string;
  role: "student" | "faculty" | "admin";
  name: string;
  email: string;
  walletAddress?: string;
  enrolledDeviceId?: string;
  createdAt: string;
}

const STORAGE_TOKEN = "auth_token";
const STORAGE_USER = "auth_user";

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const json = localStorage.getItem(STORAGE_USER);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_TOKEN);
}

export async function login(
  email: string,
  password: string
): Promise<AuthUser> {
  const client = await getApiClient();
  const result = await client.auth.login({ payload: { email, password } });

  const user: AuthUser = {
    id: result.user.id,
    role: result.user.role,
    name: result.user.name,
    email: result.user.email,
    walletAddress: result.user.walletAddress,
    enrolledDeviceId: result.user.enrolledDeviceId,
    createdAt: result.user.createdAt,
  };

  localStorage.setItem(STORAGE_TOKEN, result.token);
  localStorage.setItem(STORAGE_USER, JSON.stringify(user));

  return user;
}

export function logout() {
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
  window.location.href = "/";
}

export function requireAuth(expectedRole?: string): AuthUser {
  const user = getUser();
  const token = getToken();
  if (!user || !token) {
    throw new Error("unauthorized");
  }
  if (expectedRole && user.role !== expectedRole) {
    throw new Error("wrong_role");
  }
  return user;
}
