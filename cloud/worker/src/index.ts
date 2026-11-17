/**
 * bima-media — authenticated media store for Bima on Cloudflare R2.
 *
 * Every request carries the user's Supabase access token (Authorization: Bearer …).
 * We verify it against Supabase's public JWKS (no secrets here) and scope every object
 * to `<user id>/<file>`, so a user can only ever touch their own files.
 *
 *   GET    /m/:file                     download (streams, supports Range)
 *   HEAD   /m/:file                     exists? + size
 *   PUT    /m/:file                     upload in one request (< 95 MB)
 *   DELETE /m/:file                     delete
 *   POST   /mp/:file?op=create          start multipart upload  → { uploadId }
 *   PUT    /mp/:file?uploadId=…&part=N  upload one part         → { partNumber, etag }
 *   POST   /mp/:file?op=complete&uploadId=…   body {parts:[{partNumber,etag}]}
 *   POST   /mp/:file?op=abort&uploadId=…
 */
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface Env {
  MEDIA: R2Bucket;
  SUPABASE_URL: string; // https://<ref>.supabase.co
}

const FILE_RE = /^[A-Za-z0-9._-]{1,200}$/;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, ETag",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
const fail = (status: number, error: string) => json({ error }, status);

async function userId(req: Request, env: Env): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  jwks ??= createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
      audience: "authenticated",
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true });

    const m = /^\/(m|mp)\/([^/]+)$/.exec(url.pathname);
    if (!m) return fail(404, "not found");
    const [, kind, rawFile] = m;
    const file = decodeURIComponent(rawFile);
    if (!FILE_RE.test(file)) return fail(400, "bad file name");

    const uid = await userId(req, env);
    if (!uid) return fail(401, "unauthorized");
    const key = `${uid}/${file}`;

    if (kind === "m") {
      switch (req.method) {
        case "GET": {
          const range = req.headers.get("Range");
          const obj = await env.MEDIA.get(key, range ? { range: req.headers } : undefined);
          if (!obj) return fail(404, "missing");
          const headers = new Headers(cors);
          obj.writeHttpMetadata(headers);
          headers.set("ETag", obj.httpEtag);
          headers.set("Accept-Ranges", "bytes");
          if (range && obj.range && "offset" in obj.range) {
            const start = obj.range.offset ?? 0;
            const len = obj.range.length ?? obj.size - start;
            headers.set("Content-Range", `bytes ${start}-${start + len - 1}/${obj.size}`);
            headers.set("Content-Length", String(len));
            return new Response(obj.body, { status: 206, headers });
          }
          headers.set("Content-Length", String(obj.size));
          return new Response(obj.body, { headers });
        }
        case "HEAD": {
          const obj = await env.MEDIA.head(key);
          if (!obj) return new Response(null, { status: 404, headers: cors });
          return new Response(null, { headers: { ...cors, "Content-Length": String(obj.size), ETag: obj.httpEtag } });
        }
        case "PUT": {
          if (!req.body) return fail(400, "empty body");
          const obj = await env.MEDIA.put(key, req.body, {
            httpMetadata: { contentType: req.headers.get("Content-Type") ?? "application/octet-stream" },
          });
          return json({ ok: true, size: obj?.size ?? 0 });
        }
        case "DELETE":
          await env.MEDIA.delete(key);
          return json({ ok: true });
      }
      return fail(405, "method not allowed");
    }

    // multipart
    const op = url.searchParams.get("op");
    const uploadId = url.searchParams.get("uploadId") ?? "";
    if (req.method === "POST" && op === "create") {
      const mpu = await env.MEDIA.createMultipartUpload(key, {
        httpMetadata: { contentType: req.headers.get("Content-Type") ?? "application/octet-stream" },
      });
      return json({ uploadId: mpu.uploadId });
    }
    if (!uploadId) return fail(400, "missing uploadId");
    const mpu = env.MEDIA.resumeMultipartUpload(key, uploadId);
    if (req.method === "PUT") {
      const part = Number(url.searchParams.get("part"));
      if (!Number.isInteger(part) || part < 1 || part > 10000 || !req.body) return fail(400, "bad part");
      const up = await mpu.uploadPart(part, req.body);
      return json({ partNumber: up.partNumber, etag: up.etag });
    }
    if (req.method === "POST" && op === "complete") {
      const { parts } = (await req.json()) as { parts: R2UploadedPart[] };
      const obj = await mpu.complete(parts);
      return json({ ok: true, size: obj.size });
    }
    if (req.method === "POST" && op === "abort") {
      await mpu.abort();
      return json({ ok: true });
    }
    return fail(405, "method not allowed");
  },
};
