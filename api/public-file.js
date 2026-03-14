const { get } = require("@vercel/blob");

async function getCompat(pathname) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    return await get(pathname, { access: "private", token });
  } catch (_) {
    return get(pathname, { access: "public", token });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  try {
    const path = String(req.query?.path || "").trim();
    if (!path) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "path ausente" }));
      return;
    }

    const blob = await getCompat(path);
    const upstream = await fetch(blob.url, { cache: "no-store" });
    if (!upstream.ok) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Falha ao ler blob privado" }));
      return;
    }

    const arr = await upstream.arrayBuffer();
    const buff = Buffer.from(arr);

    res.statusCode = 200;
    res.setHeader("Content-Type", blob.contentType || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.end(buff);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Falha ao abrir arquivo publico" }));
  }
};
