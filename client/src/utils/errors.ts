import axios from 'axios';

export function getErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError<{ error?: string; errors?: string[] }>(err)) {
    const data = err.response?.data;
    if (data?.error) return data.error;
    if (Array.isArray(data?.errors) && data.errors.length > 0) return data.errors.join(', ');
    return err.message || fallback;
  }

  return fallback;
}
