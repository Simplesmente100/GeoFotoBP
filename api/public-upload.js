const { put } = require("@vercel/blob");

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }
  return JSON.parse(raw || "{}");
}

async function putWithAutoAccess(path, data, contentType) {
  let errPublic = null;
  try {
    const blob = await put(path, data, {
      access: "public",
      contentType
    });
    return { blob, accessMode: "public" };
  } catch (err) {
    errPublic = err;
  }

  try {
    const blob = await put(path, data, {
      access: "private",
      contentType
    });
    return { blob, accessMode: "private" };
  } catch (errPrivate) {
    const msgPublic = errPublic?.message || "erro-public";
    const msgPrivate = errPrivate?.message || "erro-private";
    throw new Error(`Upload falhou em ambos modos. public="${msgPublic}" private="${msgPrivate}"`);
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

    const imageBuffer = Buffer.from(imageBase64, "base64");
    const imagePath = `public-images/${Date.now()}-${fileName}`;
    const imagePut = await putWithAutoAccess(imagePath, imageBuffer, mimeType);

    const metadata = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      imagePath,
      proxyUrl: `/api/public-file?path=${encodeURIComponent(imagePath)}`,
      imageUrl: imagePut?.blob?.url || null,
      accessMode: imagePut.accessMode,
      fileName,
      dataHora,
      utmTexto,
      hash,
      createdAt: Number(createdAt) || Date.now(),
      uploadedAt: Date.now()
    };

    const metaPath = `public-meta/${metadata.id}.json`;
    metadata.metaPath = metaPath;
    await putWithAutoAccess(metaPath, JSON.stringify(metadata), "application/json");

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
        details: err?.message || String(err)
      })
    );
  }
};
