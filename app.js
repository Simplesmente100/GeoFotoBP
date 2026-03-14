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
const publicGalleryGrid = document.getElementById("publicGalleryGrid");
const publicGalleryStatus = document.getElementById("publicGalleryStatus");
const btnRefreshPublicGallery = document.getElementById("btnRefreshPublicGallery");

const DB_NAME = "geofotobp_db";
const DB_VERSION = 1;
const STORE_FOTOS = "fotos";

const API_UPLOAD_URL = "/api/public-upload";
const API_PUBLIC_FEED_URL = "/api/public-feed";
const API_PUBLIC_DELETE_URL = "/api/public-delete";

let dbPromise = null;
let lastBlob = null;
let lastFilenameBase = null;
let lastImageHash = null;
let refreshing = false;
let secretDeleteMode = false;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setGalleryStatus(msg) {
  galleryStatus.textContent = msg;
}

function setPublicGalleryStatus(msg) {
  publicGalleryStatus.textContent = msg;
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

async function atualizarFotoLocal(id, patch) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOTOS, "readwrite");
    const store = tx.objectStore(STORE_FOTOS);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) return;
      store.put({ ...item, ...patch });
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Falha ao atualizar item local."));
  });
}

async function removerFotoLocal(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOTOS, "readwrite");
    tx.objectStore(STORE_FOTOS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Falha ao remover item local."));
  });
}

function ativarAba(nome) {
  const isCaptura = nome === "captura";
  tabCaptura.classList.toggle("active", isCaptura);
  tabGaleria.classList.toggle("active", !isCaptura);
  viewCaptura.classList.toggle("hidden", !isCaptura);
  viewGaleria.classList.toggle("hidden", isCaptura);

  if (!isCaptura) {
    renderGaleria().catch(console.error);
    renderGaleriaPublica().catch(console.error);
  }
}

function formatarDataIsoParaBR(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR");
}

function criarCardGallery(item, isPublic = false) {
  const card = document.createElement("article");
  card.className = "gallery-item";

  const img = document.createElement("img");
  if (isPublic) {
    img.src = item.url;
  } else {
    img.src = URL.createObjectURL(item.blob);
  }
  img.alt = "Foto GeoFotoBP";

  const meta = document.createElement("div");
  meta.className = "gallery-meta";
  meta.textContent =
    `Data: ${item.dataHora || "-"}\n` +
    `${item.utmTexto || "UTM indisponivel"}\n` +
    `Hash: ${item.hash || "-"}\n` +
    `${isPublic ? "Origem: Publica" : `Nuvem: ${item.uploaded ? "Enviada" : "Pendente"}`}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  const btnBaixar = document.createElement("button");
  btnBaixar.className = "secondary";
  btnBaixar.textContent = "Baixar";
  if (isPublic) {
    btnBaixar.addEventListener("click", () => window.open(item.url, "_blank", "noopener,noreferrer"));
  } else {
    btnBaixar.addEventListener("click", () => baixarBlob(item.blob, item.fileName));
  }

  actions.appendChild(btnBaixar);

  if (secretDeleteMode) {
    const btnExcluir = document.createElement("button");
    btnExcluir.className = "secondary";

    if (isPublic) {
      btnExcluir.textContent = "Excluir pública";
      btnExcluir.addEventListener("click", () => excluirItemPublico(item).catch(console.error));
      actions.appendChild(btnExcluir);
    } else if (item.uploaded) {
      btnExcluir.textContent = "Excluir sincronizada";
      btnExcluir.addEventListener("click", () => excluirItemSincronizadoLocal(item).catch(console.error));
      actions.appendChild(btnExcluir);
    }
  }

  card.append(img, meta, actions);
  return card;
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
  setGalleryStatus(
    `Total local: ${ordenadas.length} | Pendentes para sincronizar: ${pendentes}` +
      (secretDeleteMode ? " | Modo exclusão ativo (Ctrl + 1)" : "")
  );

  ordenadas.forEach((item) => galleryGrid.appendChild(criarCardGallery(item, false)));
}

async function renderGaleriaPublica() {
  publicGalleryGrid.innerHTML = "";
  setPublicGalleryStatus("Carregando galeria publica...");

  try {
    const resp = await fetch(API_PUBLIC_FEED_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Erro ${resp.status}`);

    const data = await resp.json();
    const itens = (data.items || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (!itens.length) {
      setPublicGalleryStatus("Nenhuma imagem publica ainda.");
      return;
    }

    setPublicGalleryStatus(
      `Galeria publica: ${itens.length} imagem(ns).` +
        (secretDeleteMode ? " | Modo exclusão ativo (Ctrl + 1)" : "")
    );
    itens.forEach((item) => publicGalleryGrid.appendChild(criarCardGallery(item, true)));
  } catch (err) {
    console.error(err);
    setPublicGalleryStatus("Falha ao carregar galeria publica.");
  }
}

async function excluirViaApi(payload) {
  const resp = await fetch(API_PUBLIC_DELETE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Falha exclusao (${resp.status}) ${txt}`);
  }
}

async function excluirItemSincronizadoLocal(item) {
  const ok = confirm("Deseja excluir esta foto sincronizada da galeria pública e local?");
  if (!ok) return;

  if (item.metaPath || item.imagePath || item.publicUrl || item.idPublico) {
    await excluirViaApi({
      id: item.idPublico || "",
      metaPath: item.metaPath || "",
      imagePath: item.imagePath || "",
      url: item.publicUrl || ""
    });
  }

  await removerFotoLocal(item.id);
  await renderGaleria();
  await renderGaleriaPublica();
}

async function excluirItemPublico(item) {
  const ok = confirm("Deseja excluir esta foto da galeria pública?");
  if (!ok) return;

  await excluirViaApi({
    id: item.id || "",
    metaPath: item.metaPath || "",
    imagePath: item.imagePath || "",
    url: item.url || ""
  });

  await renderGaleriaPublica();
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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
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
      uploadedAt: null,
      publicUrl: null
    });

    lastBlob = blob;
    resultadoImg.src = URL.createObjectURL(blob);
    hashTexto.textContent = `${utmCompleta}\nHash real do arquivo (SHA-256): ${imageHash}`;

    btnDownload.disabled = false;
    btnDownloadHash.disabled = false;
    btnShare.disabled = false;
    setStatus("Foto gerada e salva localmente com sucesso.");

    await renderGaleria();
    await sincronizarPendentesSeOnline();
  } catch (err) {
    console.error(err);
    alert(`Nao foi possivel capturar a foto: ${err.message}`);
    setStatus(`Erro: ${err.message}`);
  } finally {
    btnFoto.disabled = false;
  }
}

async function uploadRegistroPublico(item) {
  const buffer = await blobParaArrayBuffer(item.blob);
  const imageBase64 = arrayBufferToBase64(buffer);

  const resp = await fetch(API_UPLOAD_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fileName: item.fileName,
      mimeType: "image/jpeg",
      imageBase64,
      dataHora: item.dataHora || "",
      utmTexto: item.utmTexto || "",
      hash: item.hash || "",
      createdAt: item.createdAt || Date.now()
    })
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Falha upload (${resp.status}) ${txt}`);
  }

  return resp.json();
}

async function sincronizarPendentesSeOnline() {
  if (!navigator.onLine) {
    setGalleryStatus("Sem internet. As imagens permanecem salvas localmente.");
    return;
  }

  const fotos = await getFotosLocais();
  const pendentes = fotos.filter((f) => !f.uploaded);

  if (!pendentes.length) {
    await renderGaleriaPublica();
    return;
  }

  setGalleryStatus(`Sincronizando ${pendentes.length} imagem(ns) pendente(s)...`);
  btnUploadAll.disabled = true;

  let sucesso = 0;
  let falha = 0;
  let ultimaFalha = "";

  for (const item of pendentes) {
    try {
      const resposta = await uploadRegistroPublico(item);
      await atualizarFotoLocal(item.id, {
        uploaded: true,
        uploadedAt: new Date().toISOString(),
        publicUrl: resposta?.item?.url || null,
        idPublico: resposta?.item?.id || null,
        metaPath: resposta?.item?.metaPath || null,
        imagePath: resposta?.item?.imagePath || null
      });
      sucesso += 1;
    } catch (err) {
      console.error(`Falha no upload da imagem ${item.id}:`, err);
      ultimaFalha = err?.message || "Erro desconhecido";
      falha += 1;
    }
  }

  btnUploadAll.disabled = false;
  setGalleryStatus(
    `Sincronizacao concluida. Sucesso: ${sucesso} | Falhas: ${falha}` +
      (falha ? ` | Ultima falha: ${ultimaFalha}` : "")
  );
  await renderGaleria();
  await renderGaleriaPublica();
}

function alternarModoExclusaoSecreto() {
  secretDeleteMode = !secretDeleteMode;
  const msg = secretDeleteMode
    ? "Modo exclusão ativado (Ctrl + 1)."
    : "Modo exclusão desativado.";
  setGalleryStatus(msg);
  setPublicGalleryStatus(msg);
  renderGaleria().catch(console.error);
  renderGaleriaPublica().catch(console.error);
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
btnRefreshPublicGallery.addEventListener("click", () => renderGaleriaPublica().catch(console.error));
btnUploadAll.addEventListener("click", () => sincronizarPendentesSeOnline().catch(console.error));

document.addEventListener("keydown", (event) => {
  const tag = (event.target && event.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  if (event.ctrlKey && event.key === "1") {
    event.preventDefault();
    alternarModoExclusaoSecreto();
  }
});

window.addEventListener("online", () => {
  sincronizarPendentesSeOnline().catch(console.error);
});

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
renderGaleriaPublica().catch((err) => {
  console.error(err);
  setPublicGalleryStatus("Erro ao carregar galeria publica.");
});
sincronizarPendentesSeOnline().catch(console.error);
