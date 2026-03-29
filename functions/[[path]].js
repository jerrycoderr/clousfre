const WORKER_BASE = "https://cdn-file.shaaxaal.workers.dev";
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
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      },
    });
  }

  /* =======================
     EXTRACT REAL IP (Global)
  ======================= */
  // We extract this here so BOTH uploads and normal proxying get the IP
  const xff = request.headers.get("x-forwarded-for");
  const realIP = xff ? xff.split(",")[0].trim() : request.headers.get("cf-connecting-ip") || "unknown";

  const isUpload = request.method === "POST" && url.pathname === "/upload";

  /* =================================================
     SPECIAL HANDLER — /upload (DIRECT WORKER CALL)
  ================================================= */
  if (isUpload) {
    try {
      const contentLength = Number(request.headers.get("content-length") || 0);

      /* ---------- CASE: FILE TOO LARGE ---------- */
      if (contentLength > MAX_SIZE) {
        const imgRes = await fetch(SIZE_LIMIT_IMAGE);
        const imgBuffer = await imgRes.arrayBuffer();

        const form = new FormData();
        form.append("file", new Blob([imgBuffer], { type: "image/png" }), "size-limit.png");

        const workerRes = await fetch(`${WORKER_BASE}/upload`, {
          method: "POST",
          headers: {
            "x-real-ip": realIP
            // Note: fetch automatically generates the correct Content-Type for FormData objects
          },
          body: form,
        });

        return proxyResponse(workerRes);
      }

      /* ---------- NORMAL UPLOAD ---------- */
      // 🛠️ FIX: We must pass the Content-Type header so the Worker knows the form boundary
      const contentType = request.headers.get("content-type");
      
      const workerRes = await fetch(`${WORKER_BASE}/upload`, {
        method: "POST",
        headers: {
          ...(contentType ? { "Content-Type": contentType } : {}),
          "x-real-ip": realIP
        },
        body: request.body,
        duplex: "half" // Required by Cloudflare when proxying request.body streams
      });

      return proxyResponse(workerRes);

    } catch (err) {
      return new Response(JSON.stringify({ error: "Upload failed: " + err.message }), { 
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  }

  /* =================================================
     NORMAL PROXY — ALL OTHER ENDPOINTS
  ================================================= */
  try {
    const target = WORKER_BASE + url.pathname + url.search;
    const headers = sanitizeHeaders(request.headers);
    
    // 🛠️ FIX: Inject the Real IP for all other routes
    headers.set("x-real-ip", realIP);

    const workerRes = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      ...(!["GET", "HEAD"].includes(request.method) ? { duplex: "half" } : {})
    });

    return proxyResponse(workerRes);

  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal proxy error" }), { 
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
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

  // 🛠️ FIX: Stream the body directly instead of loading into arrayBuffer. 
  // This prevents memory crashes on large files.
  return new Response(workerRes.body, {
    status: workerRes.status,
    headers,
  });
}
