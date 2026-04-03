function extractHtmlSummary(html: string) {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);

  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }

  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return bodyText.slice(0, 160);
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const responseText = await response.text();

  if (!responseText.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    const contentType = response.headers.get("content-type") ?? "unknown";
    const summary = contentType.includes("text/html")
      ? extractHtmlSummary(responseText) || "HTML error page"
      : responseText.slice(0, 160);

    throw new Error(`API returned non-JSON content (${response.status} ${response.statusText}): ${summary}`);
  }
}

export function readApiError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }

    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
  }

  return fallback;
}
