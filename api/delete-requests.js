const { list, put, del } = require("@vercel/blob");

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}");
}

function buildBlobFetchOptions() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { cache: "no-store" };
  return {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` }
  };
}

async function putCompat(path, body, contentType) {
  try {
    return await put(path, body, { access: "private", contentType });
  } catch (_) {
    return put(path, body, { access: "public", contentType });
  }
}

function isPasswordValid(password) {
  const expected = process.env.MODERATOR_PASSWORD || "bomprincipio100";
  return String(password || "") === String(expected);
}

async function fetchRequestByPath(pathname) {
  const resp = await fetch(pathname, buildBlobFetchOptions());
  if (!resp.ok) throw new Error("Falha ao ler solicitacao");
  return resp.json();
}

async function loadRequests(statusFilter = "") {
  const result = await list({ prefix: "delete-requests/" });
  const blobs = result?.blobs || [];
  const items = [];

  for (const blob of blobs) {
    try {
      const data = await fetchRequestByPath(blob.url);
      data.requestPath = blob.pathname || data.requestPath || "";
      if (statusFilter && data.status !== statusFilter) continue;
      items.push(data);
    } catch (_) {
      // Ignora item invalido
    }
  }

  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return items;
}

async function resolveRequestPath(requestPath, requestId) {
  if (requestPath) return requestPath;
  if (!requestId) return "";
  const result = await list({ prefix: `delete-requests/${requestId}` });
  const blob = (result?.blobs || [])[0];
  return blob?.pathname || "";
}

async function deleteImageAndMeta(metaPath, imagePath) {
  const targets = [metaPath, imagePath].filter(Boolean);
  if (!targets.length) return;
  await del(targets);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const status = String(req.query?.status || "").trim();
      const items = await loadRequests(status);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, items }));
      return;
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (body.action !== "request") {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Acao invalida" }));
        return;
      }

      if (!body.imagePath || !body.metaPath) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Dados da imagem incompletos" }));
        return;
      }

      const existing = await loadRequests("pending");
      const duplicate = existing.find((item) => item.imagePath === body.imagePath);
      if (duplicate) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, duplicate: true, item: duplicate }));
        return;
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const requestPath = `delete-requests/${id}.json`;
      const item = {
        id,
        requestPath,
        status: "pending",
        imagePath: body.imagePath,
        metaPath: body.metaPath,
        fileName: body.fileName || "",
        dataHora: body.dataHora || "",
        reason: body.reason || "",
        createdAt: Date.now(),
        createdAtIso: new Date().toISOString(),
        reviewedAtIso: null
      };

      await putCompat(requestPath, JSON.stringify(item), "application/json");

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, item }));
      return;
    }

    if (req.method === "PATCH") {
      const body = await readJsonBody(req);
      const { action = "", password = "" } = body;

      if (!isPasswordValid(password)) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Senha invalida" }));
        return;
      }

      if (action === "auth") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (action !== "approve" && action !== "reject") {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Acao invalida" }));
        return;
      }

      const requestPath = await resolveRequestPath(body.requestPath || "", body.requestId || "");
      if (!requestPath) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Solicitacao nao encontrada" }));
        return;
      }

      const result = await list({ prefix: requestPath });
      const blob = (result?.blobs || []).find((item) => item.pathname === requestPath) || (result?.blobs || [])[0];
      if (!blob) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Solicitacao nao encontrada" }));
        return;
      }

      const current = await fetchRequestByPath(blob.url);
      const updated = {
        ...current,
        status: action === "approve" ? "approved" : "rejected",
        reviewedAtIso: new Date().toISOString()
      };

      if (action === "approve") {
        await deleteImageAndMeta(current.metaPath || body.metaPath || "", current.imagePath || body.imagePath || "");
      }

      await putCompat(requestPath, JSON.stringify(updated), "application/json");

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, item: updated }));
      return;
    }

    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Falha nas solicitacoes de exclusao" }));
  }
};
