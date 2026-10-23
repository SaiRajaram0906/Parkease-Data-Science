/**
 * Sign-in, sign-up and admin calls. The token returned by the server is kept
 * in the browser and sent with every API request (see AuthContext).
 */
import type { AuthUser } from "@/context/AuthContext";

export const TOKEN_KEY = "parkease_token";

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export class ApiRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = storedToken();
  const response = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // keep the generic message
    }
    throw new ApiRequestError(response.status, message);
  }
  return (await response.json()) as T;
}

export interface AuthResult {
  user: AuthUser;
  token: string;
  passwordSet?: boolean;
}

export const registerAccount = (body: { name: string; email: string; password: string; role: "driver" | "owner" }) =>
  apiRequest<AuthResult>("/auth/register", { method: "POST", body });

export const signIn = (body: { email: string; password: string }) =>
  apiRequest<AuthResult>("/auth/login", { method: "POST", body });

export const demoSignIn = (role: "driver" | "owner" | "admin") =>
  apiRequest<AuthResult>("/auth/demo", { method: "POST", body: { role } });

export const fetchMe = () => apiRequest<{ user: AuthUser }>("/auth/me");

// ---------------------------------------------------------------------------
// Admin console
// ---------------------------------------------------------------------------
export interface AdminUser extends AuthUser {
  listings: number;
  bookings: number;
  datasetUserId?: string | null;
  createdAt: string;
}
export interface AdminSpot {
  id: number;
  name: string;
  city: string;
  ownerId: number | null;
  ownerName: string | null;
  pricePerHour: string;
  totalSlots: number;
  vehicleType: string;
  isActive: boolean;
}
export const listAllUsers = () => apiRequest<AdminUser[]>("/admin/users");
export const listAllSpots = () => apiRequest<AdminSpot[]>("/admin/spots");
export const changeUserRole = (id: number, role: string) =>
  apiRequest<AuthUser>(`/admin/users/${id}/role`, { method: "PATCH", body: { role } });
