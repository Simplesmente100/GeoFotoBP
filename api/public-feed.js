const { list, get } = require("@vercel/blob");

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
    const result = await list({ prefix: "public-meta/", token: process.env.BLOB_READ_WRITE_TOKEN });
    const blobs = result?.blobs || [];

    const items = [];
    for (const blob of blobs) {
      try {
        const blobData = await getCompat(blob.pathname);
        const resp = await fetch(blobData.url, { cache: "no-store" });
        if (!resp.ok) continue;
        const data = await resp.json();
        data.metaPath = data.metaPath || blob.pathname || null;
        if (data.imagePath && !data.proxyUrl) {
          data.proxyUrl = `/api/public-file?path=${encodeURIComponent(data.imagePath)}`;
        }
        items.push(data);
      } catch (_) {
        // Ignora metadados invalidos
      }
    }

    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, items }));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Falha ao carregar galeria publica" }));
  }
};
