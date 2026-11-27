/** Extract a Russian error message from a non-OK API JSON response, falling back to `fallback`. */
export async function readApiError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error ?? fallback;
}
