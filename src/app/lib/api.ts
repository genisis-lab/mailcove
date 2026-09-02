export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown; raw?: boolean };

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const { body, raw, headers, ...rest } = options;
  const init: RequestInit = { credentials: 'include', ...rest, headers: { Accept: 'application/json', ...(headers as Record<string, string>) } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, init);
  if (raw) return response as unknown as T;
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown }; message?: string } | null) ?? {};
    const code = err.error?.code ?? (response.status === 401 ? 'unauthorized' : `http_${response.status}`);
    const message = err.error?.message ?? err.message ?? (typeof data === 'string' && data ? data : `Request failed (${response.status})`);
    throw new ApiError(response.status, code, message, err.error?.details);
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });

export async function upload<T>(path: string, file: File, extra: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.set('file', file);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return api<T>(path, { method: 'POST', body: form });
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
