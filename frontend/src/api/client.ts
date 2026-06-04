import type { ChangeEvent, ChangePayload, PositionState } from "../types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    signal: controller.signal,
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  clearTimeout(timeout);
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export async function login(username: string, password: string) {
  return request<{ status: string; user: string }>("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function logout() {
  return request<{ status: string }>("/logout", { method: "POST" });
}

export async function getMe() {
  return request<{ user: string }>("/me");
}

export async function getState(at?: string) {
  const qs = at ? `?at=${encodeURIComponent(at)}` : "";
  return request<PositionState[]>(`/state${qs}`);
}

export async function getHistory(position: string) {
  return request<ChangeEvent[]>(`/component/${encodeURIComponent(position)}/history`);
}

export async function postChange(payload: ChangePayload) {
  return request<ChangeEvent>("/change", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
