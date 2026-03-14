const { put } = require("@vercel/blob");

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }
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
    const {
      fileName = `foto-${Date.now()}.jpg`,
      mimeType = "image/jpeg",
      imageBase64,
      dataHora = "",
      utmTexto = "",
      hash = "",
      createdAt = Date.now()
    } = body;

    if (!imageBase64) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "imageBase64 ausente" }));
      return;
    }

    const imageBuffer = Buffer.from(imageBase64, "base64");
    const imagePath = `public-images/${Date.now()}-${fileName}`;
    const imageBlob = await put(imagePath, imageBuffer, {
      access: "public",
      contentType: mimeType
    });

    const metadata = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      url: imageBlob.url,
      imagePath,
      fileName,
      dataHora,
      utmTexto,
      hash,
      createdAt: Number(createdAt) || Date.now(),
      uploadedAt: Date.now()
    };

    const metaPath = `public-meta/${metadata.id}.json`;
    metadata.metaPath = metaPath;
    await put(metaPath, JSON.stringify(metadata), {
      access: "public",
      contentType: "application/json"
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, item: metadata }));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Falha no upload publico" }));
  }
};
