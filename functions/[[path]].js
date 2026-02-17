const WORKER_BASE = "https://cdn-file.shaaxaaal.workers.dev";
const MAX_SIZE = 25 * 1024 * 1024; // 25MB
const SIZE_LIMIT_IMAGE = "https://cdn-file.zone.id/mylogo.png";

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  /* =======================
     CORS
  ======================= */
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods":
          "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Requested-With",
      },
    });
  }

  const isUpload =
    request.method === "POST" && url.pathname === "/upload";

  /* =================================================
     SPECIAL HANDLER — /upload
  ================================================= */
  if (isUpload) {
    try {
      const contentLength = Number(
        request.headers.get("content-length") || 0
      );

      /* ---------- CASE: FILE TOO LARGE ---------- */
      if (contentLength > MAX_SIZE) {
        const imgRes = await fetch(SIZE_LIMIT_IMAGE);
        const imgBuffer = await imgRes.arrayBuffer();

        const form = new FormData();
        form.append(
          "file",
          new Blob([imgBuffer], { type: "image/jpeg" }),
          "size-limit.jpg"
        );

        const workerRes = await fetch(`${WORKER_BASE}/upload`, {
          method: "POST",
          body: form,
        });

        return new Response(await workerRes.arrayBuffer(), {
          status: workerRes.status,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      /* ---------- CASE: NORMAL UPLOAD ---------- */
      const target = WORKER_BASE + url.pathname + url.search;

      const workerRes = await fetch(target, {
        method: "POST",
        headers: sanitizeHeaders(request.headers),
        body: request.body,
      });

      return proxyResponse(workerRes);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Upload failed" }),
        { status: 500 }
      );
    }
  }

  /* =================================================
     NORMAL PROXY — ALL OTHER ENDPOINTS
  ================================================= */
  try {
    const target = WORKER_BASE + url.pathname + url.search;

    const workerRes = await fetch(target, {
      method: request.method,
      headers: sanitizeHeaders(request.headers),
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : request.body,
    });

    return proxyResponse(workerRes);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal proxy error" }),
      { status: 500 }
    );
  }
}

/* =======================
   HELPERS
======================= */

function sanitizeHeaders(headers) {
  const out = new Headers(headers);
  out.delete("host");
  out.delete("content-length");
  out.delete("accept-encoding");
  out.set("accept-encoding", "identity");
  return out;
}

async function proxyResponse(workerRes) {
  const headers = new Headers(workerRes.headers);
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(await workerRes.arrayBuffer(), {
    status: workerRes.status,
    headers,
  });
}
