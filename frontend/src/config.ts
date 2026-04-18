function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getDefaultApiBaseUrl(): string {
  return import.meta.env.DEV ? "/api" : "";
}

function getDefaultWebSocketBaseUrl(): string {
  if (import.meta.env.DEV) {
    return `ws://${window.location.hostname}:8000`;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const configuredWebSocketBaseUrl = import.meta.env.VITE_WS_BASE_URL?.trim();

export const API_BASE_URL = stripTrailingSlash(configuredApiBaseUrl ?? getDefaultApiBaseUrl());
export const WS_BASE_URL = stripTrailingSlash(
  configuredWebSocketBaseUrl ?? getDefaultWebSocketBaseUrl(),
);

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function wsUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${WS_BASE_URL}${normalizedPath}`;
}
