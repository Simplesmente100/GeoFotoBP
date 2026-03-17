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
const btnModeratorMode = document.getElementById("btnModeratorMode");
const requestPanel = document.getElementById("requestPanel");
const requestPanelStatus = document.getElementById("requestPanelStatus");
const requestPanelList = document.getElementById("requestPanelList");

const DB_NAME = "geofotobp_db";
const DB_VERSION = 1;
const STORE_FOTOS = "fotos";

const API_UPLOAD_URL = "/api/public-upload";
const API_PUBLIC_FEED_URL = "/api/public-feed";
const API_PUBLIC_DELETE_URL = "/api/public-delete";
const API_DELETE_REQUESTS_URL = "/api/delete-requests";
const MODERATOR_SESSION_KEY = "geofotobp_moderator_session";
const MODERATOR_SESSION_HOURS = 12;

let dbPromise = null;
let lastBlob = null;
let lastFilenameBase = null;
let lastImageHash = null;
let refreshing = false;
let moderatorMode = false;
let pendingDeleteRequests = [];

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setGalleryStatus(msg) {
  galleryStatus.textContent = msg;
}

function setPublicGalleryStatus(msg) {
  publicGalleryStatus.textContent = msg;
}

function setRequestPanelStatus(msg) {
  if (requestPanelStatus) requestPanelStatus.textContent = msg;
}

function formatarDataHoraOverlay() {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}

function formatarCoordenadaHemisphere(value, positive, negative) {
  const abs = Math.abs(value).toFixed(7);
  return `${abs}${value >= 0 ? positive : negative}`;
}

function recortarTexto(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let output = text;
  while (output.length > 3 && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}...`;
}

function obterEnderecoCurto(address = {}) {
  const linha1 = [address.house_number, address.road].filter(Boolean).join(" ").trim();
  const localidade =
    address.city || address.town || address.village || address.municipality || address.county || "";
  const linha2 = [localidade, address.state].filter(Boolean).join(" - ").trim();

  return {
    linha1: linha1 || address.suburb || "Endereco indisponivel",
    linha2: linha2 || "Bom Principio do Piaui - Piaui"
  };
}

async function buscarEndereco(lat, lng) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store"
      }
    );
    if (!resp.ok) throw new Error("Falha ao consultar endereco");
    const data = await resp.json();
    return obterEnderecoCurto(data.address || {});
  } catch (_) {
    return {
      linha1: "Endereco indisponivel",
      linha2: "Bom Principio do Piaui - Piaui"
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function lonToTileX(lon, zoom) {
  return ((lon + 180) / 360) * 2 ** zoom;
}

function latToTileY(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom
  );
}

async function carregarImagem(url) {
  const resp = await fetch(url, { cache: "force-cache" });
  if (!resp.ok) throw new Error("Falha ao carregar tile");
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Falha ao decodificar tile"));
    };
    img.src = objectUrl;
  });
}

async function gerarMiniMapa(lat, lng, size = 260, zoom = 18) {
  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = size;
  mapCanvas.height = size;
  const mapCtx = mapCanvas.getContext("2d");
  mapCtx.fillStyle = "rgba(255,255,255,0.92)";
  mapCtx.fillRect(0, 0, size, size);

  try {
    const tileX = lonToTileX(lng, zoom);
    const tileY = latToTileY(lat, zoom);
    const baseX = Math.floor(tileX);
    const baseY = Math.floor(tileY);
    const pixelX = (tileX - baseX) * 256;
    const pixelY = (tileY - baseY) * 256;

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const x = baseX + offsetX;
        const y = baseY + offsetY;
        const tile = await carregarImagem(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
        const drawX = offsetX * 256 - pixelX + size / 2;
        const drawY = offsetY * 256 - pixelY + size / 2;
        mapCtx.drawImage(tile, drawX, drawY, 256, 256);
      }
    }

    mapCtx.fillStyle = "rgba(255,255,255,0.82)";
    mapCtx.fillRect(0, size - 32, size, 32);
    mapCtx.fillStyle = "#2f2f2f";
    mapCtx.font = "600 16px system-ui, sans-serif";
    mapCtx.fillText("OpenStreetMap", 10, size - 10);
  } catch (_) {
    mapCtx.fillStyle = "rgba(245,245,245,0.96)";
    mapCtx.fillRect(0, 0, size, size);
    mapCtx.fillStyle = "#4a4a4a";
    mapCtx.font = "600 18px system-ui, sans-serif";
    mapCtx.fillText("Mapa indisponivel", 42, size / 2);
  }

  const centerX = size / 2;
  const centerY = size / 2;
  mapCtx.fillStyle = "#e74c3c";
  mapCtx.beginPath();
  mapCtx.arc(centerX, centerY - 14, 12, 0, Math.PI * 2);
  mapCtx.fill();
  mapCtx.beginPath();
  mapCtx.moveTo(centerX, centerY + 18);
  mapCtx.lineTo(centerX - 10, centerY - 2);
  mapCtx.lineTo(centerX + 10, centerY - 2);
  mapCtx.closePath();
  mapCtx.fill();
  mapCtx.fillStyle = "#ffffff";
  mapCtx.beginPath();
  mapCtx.arc(centerX, centerY - 14, 4.5, 0, Math.PI * 2);
  mapCtx.fill();

  return mapCanvas;
}

function desenharMiniMapaNaFoto(ctx, mapCanvas, x, y, size) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.fillRect(x, y, size, size);
  ctx.drawImage(mapCanvas, x, y, size, size);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, size, size);
  ctx.restore();
}

function desenharBlocoInfo(ctx, info, x, y, maxWidth, lineHeight) {
  const lines = [
    info.dataHora,
    info.coordenadas,
    info.endereco1,
    info.endereco2
  ].filter(Boolean);

  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.font = "500 23px system-ui, sans-serif";

  lines.forEach((line, index) => {
    const safeLine = recortarTexto(ctx, line, maxWidth);
    const lineY = y + index * lineHeight;
    ctx.strokeText(safeLine, x, lineY);
    ctx.fillText(safeLine, x, lineY);
  });

  ctx.restore();
}

function setModeratorVisualState() {
  if (!btnModeratorMode) return;
  btnModeratorMode.classList.toggle("is-active", moderatorMode);
  btnModeratorMode.title = moderatorMode ? "Modo moderador ativo" : "Entrar no modo moderador";
}

function salvarSessaoModerador() {
  const expiresAt = Date.now() + MODERATOR_SESSION_HOURS * 60 * 60 * 1000;
  localStorage.setItem(MODERATOR_SESSION_KEY, JSON.stringify({ expiresAt }));
}

function limparSessaoModerador() {
  localStorage.removeItem(MODERATOR_SESSION_KEY);
}

function carregarSessaoModerador() {
  try {
    const raw = localStorage.getItem(MODERATOR_SESSION_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed?.expiresAt || Date.now() > parsed.expiresAt) {
      limparSessaoModerador();
      return false;
    }
    return true;
  } catch (_) {
    limparSessaoModerador();
    return false;
  }
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

async function validarSenhaModerador(password) {
  const resp = await fetch(API_DELETE_REQUESTS_URL, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "auth", password })
  });
  if (!resp.ok) return false;
  const data = await resp.json().catch(() => ({}));
  return Boolean(data?.ok);
}

async function entrarOuSairModoModerador() {
  if (moderatorMode) {
    moderatorMode = false;
    limparSessaoModerador();
    pendingDeleteRequests = [];
    setModeratorVisualState();
    requestPanel.classList.add("hidden");
    setGalleryStatus("Modo moderador desativado.");
    setPublicGalleryStatus("Modo moderador desativado.");
    await renderGaleria();
    await renderGaleriaPublica();
    return;
  }

  const password = prompt("Digite a senha para entrar no modo moderador:");
  if (!password) return;

  try {
    const ok = await validarSenhaModerador(password.trim());
    if (!ok) {
      alert("Senha incorreta.");
      return;
    }
    moderatorMode = true;
    salvarSessaoModerador();
    setModeratorVisualState();
    setGalleryStatus("Modo moderador ativado.");
    await carregarSolicitacoesExclusao();
    await renderGaleria();
    await renderGaleriaPublica();
  } catch (err) {
    console.error(err);
    alert("Falha ao validar senha de moderador.");
  }
}

async function carregarSolicitacoesExclusao() {
  if (!moderatorMode) {
    pendingDeleteRequests = [];
    requestPanel.classList.add("hidden");
    return;
  }

  setRequestPanelStatus("Carregando solicitacoes...");
  requestPanel.classList.remove("hidden");

  try {
    const resp = await fetch(`${API_DELETE_REQUESTS_URL}?status=pending`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Erro ${resp.status}`);
    const data = await resp.json();
    pendingDeleteRequests = (data.items || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!pendingDeleteRequests.length) {
      setRequestPanelStatus("Nao ha solicitacoes pendentes.");
    } else {
      setRequestPanelStatus(`Solicitacoes pendentes: ${pendingDeleteRequests.length}`);
    }
    renderPainelSolicitacoes();
  } catch (err) {
    console.error(err);
    setRequestPanelStatus("Falha ao carregar solicitacoes.");
  }
}

function renderPainelSolicitacoes() {
  if (!requestPanelList) return;
  requestPanelList.innerHTML = "";
  if (!moderatorMode || !pendingDeleteRequests.length) return;

  pendingDeleteRequests.forEach((request) => {
    const item = document.createElement("div");
    item.className = "request-item";

    const meta = document.createElement("div");
    meta.className = "gallery-meta";
    meta.textContent =
      `Solicitada em: ${formatarDataIsoParaBR(request.createdAtIso)}\n` +
      `Arquivo: ${request.fileName || "-"}\n` +
      `Data da imagem: ${request.dataHora || "-"}\n` +
      `Motivo: ${request.reason || "Nao informado"}`;

    const actions = document.createElement("div");
    actions.className = "actions";

    const btnAprovar = document.createElement("button");
    btnAprovar.className = "secondary";
    btnAprovar.textContent = "Excluir imagem";
    btnAprovar.addEventListener("click", () => moderarSolicitacao(request, "approve").catch(console.error));

    const btnRecusar = document.createElement("button");
    btnRecusar.className = "secondary";
    btnRecusar.textContent = "Recusar";
    btnRecusar.addEventListener("click", () => moderarSolicitacao(request, "reject").catch(console.error));

    actions.append(btnAprovar, btnRecusar);
    item.append(meta, actions);
    requestPanelList.appendChild(item);
  });
}

async function moderarSolicitacao(request, action) {
  const password = prompt("Confirme a senha do moderador:");
  if (!password) return;

  const resp = await fetch(API_DELETE_REQUESTS_URL, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      password: password.trim(),
      requestId: request.id,
      requestPath: request.requestPath,
      imagePath: request.imagePath,
      metaPath: request.metaPath
    })
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Falha ao moderar (${resp.status}) ${txt}`);
  }

  await carregarSolicitacoesExclusao();
  await renderGaleria();
  await renderGaleriaPublica();
}

async function solicitarExclusaoImagem(item) {
  const reason = prompt("Opcional: informe o motivo da solicitacao de exclusao:", "") || "";
  const payload = {
    action: "request",
    imagePath: item.imagePath || "",
    metaPath: item.metaPath || "",
    fileName: item.fileName || "",
    dataHora: item.dataHora || "",
    reason: reason.trim()
  };

  const resp = await fetch(API_DELETE_REQUESTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Falha ao solicitar exclusao (${resp.status}) ${txt}`);
  }

  const data = await resp.json().catch(() => ({}));
  if (data?.item?.imagePath) {
    pendingDeleteRequests.push(data.item);
  }
  alert(data?.duplicate ? "Esta imagem ja possui solicitacao pendente." : "Solicitacao enviada com sucesso.");
  if (moderatorMode) await carregarSolicitacoesExclusao();
  await renderGaleriaPublica();
}

function criarCardGallery(item, isPublic = false) {
  const card = document.createElement("article");
  card.className = "gallery-item";

  const img = document.createElement("img");
  if (isPublic) {
    img.src = item.proxyUrl || item.url;
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
    btnBaixar.addEventListener(
      "click",
      () => window.open(item.proxyUrl || item.url, "_blank", "noopener,noreferrer")
    );
  } else {
    btnBaixar.addEventListener("click", () => baixarBlob(item.blob, item.fileName));
  }

  actions.appendChild(btnBaixar);

  if (isPublic) {
    const jaSolicitada = pendingDeleteRequests.some((req) => req.imagePath === item.imagePath);
    const btnSolicitar = document.createElement("button");
    btnSolicitar.className = "secondary";
    btnSolicitar.textContent = jaSolicitada ? "Exclusao solicitada" : "Solicitar exclusao de imagem";
    btnSolicitar.disabled = jaSolicitada;
    btnSolicitar.addEventListener("click", () => solicitarExclusaoImagem(item).catch(console.error));
    actions.appendChild(btnSolicitar);
  }

  if (moderatorMode) {
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
      (moderatorMode ? " | Modo moderador ativo" : "")
  );

  ordenadas.forEach((item) => galleryGrid.appendChild(criarCardGallery(item, false)));
}

async function renderGaleriaPublica() {
  publicGalleryGrid.innerHTML = "";
  setPublicGalleryStatus("Carregando galeria publica...");
  if (!moderatorMode) {
    requestPanel.classList.add("hidden");
  }

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
        (moderatorMode ? " | Modo moderador ativo" : "")
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
    setStatus("Capturando foto e localizacao...");

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
    let geo = null;
    let coordenadasTexto = "Coordenadas indisponiveis";
    let endereco = {
      linha1: "Endereco indisponivel",
      linha2: "Bom Principio do Piaui - Piaui"
    };
    let miniMapaCanvas = null;

    try {
      geo = await obterLocalizacao();
      const utm = latLngParaUTM(geo.lat, geo.lng);
      utmTexto = `UTM: Z${utm.zona}${utm.hemisferio} E ${utm.easting} N ${utm.northing}`;
      utmCompleta = `${utmTexto} (WGS84)`;
      coordenadasTexto = `${formatarCoordenadaHemisphere(geo.lat, "N", "S")} ${formatarCoordenadaHemisphere(
        geo.lng,
        "E",
        "W"
      )}`;
      endereco = await buscarEndereco(geo.lat, geo.lng);
      miniMapaCanvas = await gerarMiniMapa(geo.lat, geo.lng);
    } catch (_) {
      alert("Permissao de localizacao negada ou indisponivel. A foto sera gerada sem coordenadas precisas.");
    }

    const dataHora = dataHoraBR();
    const dataHoraOverlay = formatarDataHoraOverlay();
    const margem = Math.max(24, Math.round(w * 0.02));
    const mapSize = Math.max(220, Math.round(Math.min(w, h) * 0.3));
    const mapX = margem;
    const mapY = h - margem - mapSize;
    const infoX = w - margem;
    const infoY = h - margem - 142;

    if (miniMapaCanvas) {
      desenharMiniMapaNaFoto(ctx, miniMapaCanvas, mapX, mapY, mapSize);
    }

    desenharBlocoInfo(
      ctx,
      {
        dataHora: dataHoraOverlay,
        coordenadas: coordenadasTexto,
        endereco1: endereco.linha1,
        endereco2: endereco.linha2
      },
      infoX,
      infoY,
      Math.max(300, w * 0.5),
      40
    );

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
    hashTexto.textContent =
      `${utmCompleta}\n` +
      `${coordenadasTexto}\n` +
      `${endereco.linha1}\n${endereco.linha2}\n` +
      `Hash real do arquivo (SHA-256): ${imageHash}`;

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
  btnUploadAll.disabled = false;

  if (!navigator.onLine) {
    setGalleryStatus("Sem internet. As imagens permanecem salvas localmente.");
    btnUploadAll.disabled = false;
    return;
  }

  try {
    const fotos = await getFotosLocais();
    const pendentes = fotos.filter((f) => !f.uploaded);

    if (!pendentes.length) {
      setGalleryStatus("Nao ha pendentes para sincronizar.");
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

    setGalleryStatus(
      `Sincronizacao concluida. Sucesso: ${sucesso} | Falhas: ${falha}` +
        (falha ? ` | Ultima falha: ${ultimaFalha}` : "")
    );
    await renderGaleria();
    await renderGaleriaPublica();
  } catch (err) {
    console.error(err);
    setGalleryStatus(`Erro na sincronizacao: ${err?.message || "erro desconhecido"}`);
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
btnRefreshPublicGallery.addEventListener("click", () => renderGaleriaPublica().catch(console.error));
btnUploadAll.addEventListener("click", () => sincronizarPendentesSeOnline().catch(console.error));
btnModeratorMode.addEventListener("click", () => entrarOuSairModoModerador().catch(console.error));

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
moderatorMode = carregarSessaoModerador();
setModeratorVisualState();
renderGaleria().catch((err) => {
  console.error(err);
  setGalleryStatus("Erro ao carregar galeria local.");
});
renderGaleriaPublica().catch((err) => {
  console.error(err);
  setPublicGalleryStatus("Erro ao carregar galeria publica.");
});
carregarSolicitacoesExclusao().catch(console.error);
sincronizarPendentesSeOnline().catch(console.error);
