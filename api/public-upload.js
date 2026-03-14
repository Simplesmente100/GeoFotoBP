const { put } = require("@vercel/blob");

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }
  return JSON.parse(raw || "{}");
}

function getAccessMode() {
  const mode = String(process.env.BLOB_ACCESS_MODE || "public").toLowerCase();
  return mode === "private" ? "private" : "public";
}

async function putWithMode(path, data, contentType, accessMode) {
  const primaryMode = accessMode === "private" ? "private" : "public";
  const fallbackMode = primaryMode === "public" ? "private" : "public";

  try {
    return await put(path, data, {
      access: primaryMode,
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
  } catch (firstErr) {
    try {
      return await put(path, data, {
        access: fallbackMode,
        contentType,
        token: process.env.BLOB_READ_WRITE_TOKEN
      });
    } catch (secondErr) {
      const firstMsg = String(firstErr?.message || "");
      const secondMsg = String(secondErr?.message || "");
      throw new Error(`Falha nos dois modos de access. [${primaryMode}] ${firstMsg} | [${fallbackMode}] ${secondMsg}`);
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          error: "BLOB_READ_WRITE_TOKEN ausente no ambiente de produção."
        })
      );
      return;
    }

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

    const accessMode = getAccessMode();
    const imageBuffer = Buffer.from(imageBase64, "base64");
    const imagePath = `public-images/${Date.now()}-${fileName}`;
    const imageBlob = await putWithMode(imagePath, imageBuffer, mimeType, accessMode);

    const metadata = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      imagePath,
      proxyUrl: `/api/public-file?path=${encodeURIComponent(imagePath)}`,
      imageUrl: imageBlob?.url || null,
      accessMode,
      fileName,
      dataHora,
      utmTexto,
      hash,
      createdAt: Number(createdAt) || Date.now(),
      uploadedAt: Date.now()
    };

    const metaPath = `public-meta/${metadata.id}.json`;
    metadata.metaPath = metaPath;
    await putWithMode(metaPath, JSON.stringify(metadata), "application/json", accessMode);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, item: metadata }));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        error: "Falha no upload publico",
        details: err?.message || String(err),
        hint: "Defina BLOB_ACCESS_MODE como public ou private no Vercel e refaca o deploy."
      })
    );
  }
};
