const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const resultadoImg = document.getElementById("resultadoImg");
const hashTexto = document.getElementById("hashTexto");
const btnFoto = document.getElementById("btnFoto");
const btnDownload = document.getElementById("btnDownload");
const btnDownloadHash = document.getElementById("btnDownloadHash");
const btnShare = document.getElementById("btnShare");
const tabCaptura = document.getElementById("tabCaptura");
const tabGaleria = document.getElementById("tabGaleria");
const viewCaptura = document.getElementById("viewCaptura");
const viewGaleria = document.getElementById("viewGaleria");
const galleryGrid = document.getElementById("galleryGrid");
const galleryStatus = document.getElementById("galleryStatus");
const btnRefreshGallery = document.getElementById("btnRefreshGallery");
const btnUploadAll = document.getElementById("btnUploadAll");

const DB_NAME = "geofotobp_db";
const DB_VERSION = 1;
const STORE_FOTOS = "fotos";

// Defina aqui a conta/endpoint de nuvem já escolhido para upload.
const CLOUD_UPLOAD_URL = "https://mega.nz/filerequest/RAYcZ41lCPQ";
const CLOUD_UPLOAD_TOKEN = "";

let dbPromise = null;
let lastBlob = null;
let lastFilenameBase = null;
let lastImageHash = null;
let refreshing = false;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setGalleryStatus(msg) {
  galleryStatus.textContent = msg;
}

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FOTOS)) {
        const store = db.createObjectStore(STORE_FOTOS, { keyPath: "id", autoIncrement: true });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("uploaded", "uploaded", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Falha ao abrir banco local."));
  });

  return dbPromise;
}

async function addFotoLocal(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOTOS, "readwrite");
    tx.objectStore(STORE_FOTOS).add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Falha ao salvar foto local."));
  });
}

async function getFotosLocais() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOTOS, "readonly");
    const req = tx.objectStore(STORE_FOTOS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error("Falha ao listar fotos locais."));
  });
}

async function marcarComoEnviada(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOTOS, "readwrite");
    const store = tx.objectStore(STORE_FOTOS);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) return;
      item.uploaded = true;
      item.uploadedAt = new Date().toISOString();
      store.put(item);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Falha ao atualizar status de upload."));
  });
}

function formatarDataIsoParaBR(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR");
}

function ativarAba(nome) {
  const isCaptura = nome === "captura";
  tabCaptura.classList.toggle("active", isCaptura);
  tabGaleria.classList.toggle("active", !isCaptura);
  viewCaptura.classList.toggle("hidden", !isCaptura);
  viewGaleria.classList.toggle("hidden", isCaptura);

  if (!isCaptura) {
    renderGaleria().catch((err) => {
      console.error(err);
      setGalleryStatus("Erro ao carregar galeria local.");
    });
  }
}

async function renderGaleria() {
  const fotos = await getFotosLocais();
  const ordenadas = fotos.sort((a, b) => b.createdAt - a.createdAt);

  galleryGrid.innerHTML = "";

  if (!ordenadas.length) {
    setGalleryStatus("Nenhuma imagem salva localmente ainda.");
    return;
  }

  const pendentes = ordenadas.filter((f) => !f.uploaded).length;
  setGalleryStatus(`Total local: ${ordenadas.length} | Pendentes de nuvem: ${pendentes}`);

  ordenadas.forEach((item) => {
    const card = document.createElement("article");
    card.className = "gallery-item";

    const img = document.createElement("img");
    const imgUrl = URL.createObjectURL(item.blob);
    img.src = imgUrl;
    img.alt = "Foto salva localmente";

    const meta = document.createElement("div");
    meta.className = "gallery-meta";
    meta.textContent =
      `Data: ${item.dataHora}\n` +
      `${item.utmTexto}\n` +
      `Hash: ${item.hash}\n` +
      `Nuvem: ${item.uploaded ? "Enviada" : "Pendente"}`;

    const actions = document.createElement("div");
    actions.className = "actions";

    const btnBaixar = document.createElement("button");
    btnBaixar.className = "secondary";
    btnBaixar.textContent = "Baixar";
    btnBaixar.addEventListener("click", () => baixarBlob(item.blob, item.fileName));

    actions.appendChild(btnBaixar);
    card.append(img, meta, actions);
    galleryGrid.appendChild(card);
  });
}

async function iniciarCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Seu navegador nao suporta camera.");
    alert("Seu navegador nao suporta camera.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    video.srcObject = stream;
    setStatus("Camera pronta.");
  } catch (err) {
    console.error(err);
    setStatus("Permissao de camera negada ou indisponivel.");
    alert("Permissao de camera negada ou indisponivel.");
  }
}

function obterLocalizacao() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocalizacao nao suportada."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function dataHoraBR() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function latLngParaUTM(latitude, longitude) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ePrime2 = e2 / (1 - e2);

  const latRad = (latitude * Math.PI) / 180;
  const lonRad = (longitude * Math.PI) / 180;

  const zona = Math.floor((longitude + 180) / 6) + 1;
  const lonCentralGraus = zona * 6 - 183;
  const lonCentralRad = (lonCentralGraus * Math.PI) / 180;
  const hemisferio = latitude >= 0 ? "N" : "S";

  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = ePrime2 * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lonRad - lonCentralRad);

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latRad) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad));

  const easting =
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T ** 2 + 72 * C - 58 * ePrime2) * A ** 5) / 120) +
    500000;

  let northing =
    k0 *
    (M +
      N *
        Math.tan(latRad) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * ePrime2) * A ** 6) / 720));

  if (latitude < 0) northing += 10000000;

  return {
    zona,
    hemisferio,
    easting: easting.toFixed(2),
    northing: northing.toFixed(2)
  };
}

async function sha256Hex(texto) {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256HexArrayBuffer(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function blobParaArrayBuffer(blob) {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Falha ao ler arquivo para hash."));
    reader.readAsArrayBuffer(blob);
  });
}

function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

function baixarTexto(conteudo, nomeArquivo) {
  const blob = new Blob([conteudo], { type: "text/plain;charset=utf-8" });
  baixarBlob(blob, nomeArquivo);
}

async function capturarFoto() {
  try {
    btnFoto.disabled = true;
    setStatus("Capturando foto e coletando localizacao...");

    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("A camera ainda nao esta pronta.");
    }

    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    ctx.drawImage(video, 0, 0, w, h);

    let utmTexto = "UTM indisponivel";
    let utmCompleta = "UTM indisponivel";

    try {
      const geo = await obterLocalizacao();
      const utm = latLngParaUTM(geo.lat, geo.lng);
      utmTexto = `UTM: Z${utm.zona}${utm.hemisferio} E ${utm.easting} N ${utm.northing}`;
      utmCompleta = `${utmTexto} (WGS84)`;
    } catch (_) {
      alert("Permissao de localizacao negada ou indisponivel. A foto sera gerada sem coordenadas precisas.");
    }

    const dataHora = dataHoraBR();
    const linhasPrincipais = [`Data: ${dataHora}`, utmTexto];

    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 4;

    const lineHeightPrincipal = 29;
    const margem = 22;
    const alturaTexto = linhasPrincipais.length * lineHeightPrincipal;
    const yBase = h - margem - alturaTexto;

    let yAtual = yBase;

    ctx.font = "21px system-ui, sans-serif";
    linhasPrincipais.forEach((linha) => {
      ctx.strokeText(linha, margem, yAtual);
      ctx.fillText(linha, margem, yAtual);
      yAtual += lineHeightPrincipal;
    });

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
    if (!blob) throw new Error("Falha ao gerar imagem final.");

    const imageHash = await sha256HexArrayBuffer(await blobParaArrayBuffer(blob));

    lastFilenameBase = `GeoFotoBP-${Date.now()}`;
    lastImageHash = imageHash;

    await addFotoLocal({
      createdAt: Date.now(),
      createdAtIso: new Date().toISOString(),
      dataHora,
      utmTexto: utmCompleta,
      hash: imageHash,
      fileName: `${lastFilenameBase}.jpg`,
      hashFileName: `${lastFilenameBase}.sha256.txt`,
      blob,
      uploaded: false,
      uploadedAt: null
    });

    lastBlob = blob;
    resultadoImg.src = URL.createObjectURL(blob);
    hashTexto.textContent =
      `${utmCompleta}\nHash real do arquivo (SHA-256): ${imageHash}`;

    btnDownload.disabled = false;
    btnDownloadHash.disabled = false;
    btnShare.disabled = false;
    setStatus("Foto gerada e salva localmente com sucesso.");

    await renderGaleria();
  } catch (err) {
    console.error(err);
    alert(`Nao foi possivel capturar a foto: ${err.message}`);
    setStatus(`Erro: ${err.message}`);
  } finally {
    btnFoto.disabled = false;
  }
}

async function uploadRegistroParaNuvem(item, uploadUrl) {
  const formData = new FormData();
  const file = new File([item.blob], item.fileName, { type: "image/jpeg" });
  formData.append("file", file);
  formData.append(
    "metadata",
    JSON.stringify({
      data_hora: item.dataHora,
      utm: item.utmTexto,
      hash: item.hash,
      origem: "GeoFotoBP"
    })
  );

  const headers = {};
  if (CLOUD_UPLOAD_TOKEN) headers.Authorization = `Bearer ${CLOUD_UPLOAD_TOKEN}`;

  const resp = await fetch(uploadUrl, {
    method: "POST",
    headers,
    body: formData
  });

  if (!resp.ok) throw new Error(`Falha upload (${resp.status})`);
}

function isMegaFileRequestUrl(url) {
  return /https?:\/\/mega\.nz\/filerequest/i.test(url);
}

async function uploadTodasPendentes() {
  const uploadUrl = (CLOUD_UPLOAD_URL || "").trim();
  if (!/^https?:\/\//i.test(uploadUrl)) {
    alert("Configure CLOUD_UPLOAD_URL com uma URL valida de endpoint HTTP/HTTPS.");
    return;
  }

  if (isMegaFileRequestUrl(uploadUrl)) {
    setGalleryStatus("Abrindo formulario do MEGA para envio das imagens...");
    window.open(uploadUrl, "_blank", "noopener,noreferrer");
    alert("O MEGA File Request nao disponibiliza endpoint de API direta para envio em lote pelo navegador. O formulario do MEGA foi aberto para envio.");
    return;
  }

  setGalleryStatus("Enviando imagens pendentes para nuvem...");
  btnUploadAll.disabled = true;

  try {
    const fotos = await getFotosLocais();
    const pendentes = fotos.filter((f) => !f.uploaded);

    if (!pendentes.length) {
      setGalleryStatus("Nao ha imagens pendentes para upload.");
      return;
    }

    let sucesso = 0;
    let falha = 0;

    for (const item of pendentes) {
      try {
        await uploadRegistroParaNuvem(item, uploadUrl);
        await marcarComoEnviada(item.id);
        sucesso += 1;
      } catch (err) {
        console.error(`Falha no upload da imagem ${item.id}:`, err);
        falha += 1;
      }
    }

    setGalleryStatus(`Upload concluido. Sucesso: ${sucesso} | Falhas: ${falha}`);
    await renderGaleria();
  } finally {
    btnUploadAll.disabled = false;
  }
}

btnFoto.addEventListener("click", capturarFoto);

btnDownload.addEventListener("click", () => {
  if (!lastBlob) return;
  const nome = `${lastFilenameBase || `GeoFotoBP-${Date.now()}`}.jpg`;
  baixarBlob(lastBlob, nome);
});

btnDownloadHash.addEventListener("click", () => {
  if (!lastImageHash) return;
  const base = lastFilenameBase || `GeoFotoBP-${Date.now()}`;
  const nomeImagem = `${base}.jpg`;
  const nomeHash = `${base}.sha256.txt`;
  baixarTexto(`${lastImageHash}  ${nomeImagem}\n`, nomeHash);
});

btnShare.addEventListener("click", async () => {
  if (!lastBlob) return;

  if (!navigator.share) {
    alert("Compartilhamento nao suportado neste navegador.");
    return;
  }

  try {
    const file = new File([lastBlob], `GeoFotoBP-${Date.now()}.jpg`, { type: "image/jpeg" });

    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      alert("Seu navegador nao suporta compartilhamento de arquivos.");
      return;
    }

    await navigator.share({
      title: "GeoFotoBP",
      text: "Foto auditavel gerada no GeoFotoBP",
      files: [file]
    });
  } catch (err) {
    if (err.name !== "AbortError") alert("Falha ao compartilhar a imagem.");
  }
});

tabCaptura.addEventListener("click", () => ativarAba("captura"));
tabGaleria.addEventListener("click", () => ativarAba("galeria"));
btnRefreshGallery.addEventListener("click", () => renderGaleria().catch(console.error));
btnUploadAll.addEventListener("click", () => uploadTodasPendentes().catch(console.error));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
      registration.update();

      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (err) {
      console.error("Erro ao registrar service worker:", err);
    }
  });
}

iniciarCamera();
renderGaleria().catch((err) => {
  console.error(err);
  setGalleryStatus("Erro ao carregar galeria local.");
});
