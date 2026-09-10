import axios, { AxiosError } from 'axios';

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

// Server errors are `{ error: string }` from AppError. Extract the message
// from an unknown thrown value (mutation onError, try/catch handler) without
// resorting to `as any`. Falls through to a caller-supplied default when the
// value isn't an axios error or lacks the expected shape.
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const e = err as AxiosError<{ error?: string }>;
    const msg = e.response?.data?.error;
    if (typeof msg === 'string' && msg.trim()) return msg;
    if (e.message) return e.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
