const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4010";

function buildBackendUrl(slug: string[], search: string) {
  const base = BACKEND_BASE_URL.replace(/\/$/, "");
  return `${base}/api/${slug.join("/")}${search}`;
}

async function proxyRequest(request: Request, context: { params: Promise<{ slug: string[] }> }) {
  try {
    const { slug } = await context.params;
    const targetUrl = buildBackendUrl(slug, new URL(request.url).search);
    const method = request.method;
    const requestBody = method === "GET" || method === "HEAD" ? undefined : await request.text();

    const upstream = await fetch(targetUrl, {
      method,
      headers: {
        Accept: request.headers.get("accept") ?? "application/json",
        ...(request.headers.get("content-type")
          ? { "Content-Type": request.headers.get("content-type") as string }
          : {}),
      },
      body: requestBody,
      cache: "no-store",
    });

    const responseText = await upstream.text();
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type") ?? "application/json; charset=utf-8";
    const isEventStream = contentType.includes("text/event-stream");
    const isJson = contentType.includes("application/json");

    if (!upstream.ok && !isJson) {
      return Response.json(
        {
          error: `Upstream returned non-JSON content (${upstream.status} ${upstream.statusText})`,
          message: responseText.slice(0, 300) || "Upstream returned an empty non-JSON response",
          statusCode: upstream.status,
          code: "UPSTREAM_NON_JSON",
        },
        {
          status: upstream.status,
        },
      );
    }

    headers.set("content-type", isEventStream ? "text/event-stream" : contentType);

    return new Response(responseText, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Proxy request failed",
        message: error instanceof Error ? error.message : "Proxy request failed",
        statusCode: 502,
        code: "PROXY_REQUEST_FAILED",
      },
      {
        status: 502,
      },
    );
  }
}

export async function GET(request: Request, context: { params: Promise<{ slug: string[] }> }) {
  return proxyRequest(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ slug: string[] }> }) {
  return proxyRequest(request, context);
}

export async function PATCH(request: Request, context: { params: Promise<{ slug: string[] }> }) {
  return proxyRequest(request, context);
}
