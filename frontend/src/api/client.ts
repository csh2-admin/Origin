import type { ChangeEvent, ChangePayload, ComponentPhoto, PartCatalogEntry, PositionState, UsageStats } from "../types";

const BASE = import.meta.env.DEV ? "/api" : "";

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

export async function getPartsCatalog(position?: string) {
  const qs = position ? `?position=${encodeURIComponent(position)}` : "";
  return request<PartCatalogEntry[]>(`/parts-catalog${qs}`);
}

export async function getAllUsage() {
  return request<Record<string, { est_cycles: number; runtime_hours: number }>>("/usage");
}

export async function getUsage(position: string) {
  return request<UsageStats>(`/component/${encodeURIComponent(position)}/usage`);
}

export async function postChange(payload: ChangePayload) {
  return request<ChangeEvent>("/change", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getPhotos(position: string) {
  return request<ComponentPhoto[]>(`/component/${encodeURIComponent(position)}/photos`);
}

export async function uploadPhoto(
  position: string,
  file: File,
  photoType: string,
  caption: string,
  changeEventId?: number,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("photo_type", photoType);
  form.append("caption", caption);
  if (changeEventId != null) form.append("change_event_id", String(changeEventId));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const res = await fetch(`${BASE}/component/${encodeURIComponent(position)}/photos`, {
    method: "POST",
    credentials: "include",
    signal: controller.signal,
    body: form,
  });
  clearTimeout(timeout);
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<ComponentPhoto>;
}

export async function deletePhoto(photoId: number) {
  return request<{ status: string }>(`/photo/${photoId}`, { method: "DELETE" });
}
