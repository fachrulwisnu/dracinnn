/**
 * Safe API Call helper that checks Content-Type and HTTP status before parsing JSON.
 * Prevents "Unexpected token '<', '<!DOCTYPE ...' is not valid JSON" errors when
 * backend endpoints return HTML 404 or 500 error pages.
 */
export async function safeApiCall<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';

    // Check if the response is HTML or non-JSON
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      const snippet = text.slice(0, 300).replace(/\s+/g, ' ');
      console.error(`[API Error] Non-JSON response from ${url} (HTTP ${res.status} ${res.statusText}):`, snippet);
      throw new Error(
        `Server returned non-JSON response (HTTP ${res.status} ${res.statusText}). Endpoint "${url}" may be missing or failing.`
      );
    }

    const data = await res.json();
    if (!res.ok) {
      const errorMessage = data?.error || data?.message || `HTTP ${res.status} ${res.statusText}`;
      throw new Error(errorMessage);
    }

    return data as T;
  } catch (err: any) {
    console.error(`[safeApiCall Exception] ${url}:`, err.message || err);
    throw err;
  }
}
