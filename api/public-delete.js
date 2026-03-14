const { list, del } = require("@vercel/blob");

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const { id = "", metaPath = "", imagePath = "", url = "" } = body;

    let resolvedMetaPath = metaPath;
    let resolvedImagePath = imagePath;

    if (!resolvedMetaPath && id) {
      const metaList = await list({ prefix: `public-meta/${id}` });
      const metaBlob = (metaList?.blobs || [])[0];
      if (metaBlob?.pathname) {
        resolvedMetaPath = metaBlob.pathname;
        try {
          const r = await fetch(metaBlob.url, { cache: "no-store" });
          if (r.ok) {
            const m = await r.json();
            resolvedImagePath = resolvedImagePath || m.imagePath || "";
          }
        } catch (_) {
          // Ignora falha de leitura de metadado
        }
      }
    }

    if (!resolvedImagePath && url) {
      try {
        const u = new URL(url);
        const path = u.pathname.startsWith("/") ? u.pathname.slice(1) : u.pathname;
        if (path) resolvedImagePath = path;
      } catch (_) {
        // ignora
      }
    }

    const targets = [resolvedMetaPath, resolvedImagePath].filter(Boolean);
    if (!targets.length) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Sem caminho para exclusao" }));
      return;
    }

    await del(targets);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, deleted: targets }));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Falha ao excluir item" }));
  }
};
