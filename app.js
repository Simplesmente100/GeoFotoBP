const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const resultadoImg = document.getElementById("resultadoImg");
const hashTexto = document.getElementById("hashTexto");
const btnFoto = document.getElementById("btnFoto");
const btnDownload = document.getElementById("btnDownload");
const btnComprovante = document.getElementById("btnComprovante");
const btnShare = document.getElementById("btnShare");

let lastBlob = null;
let lastMetadata = null;
let lastFilenameBase = null;
let refreshing = false;

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function iniciarCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Seu navegador nao suporta camera.");
    setStatus("Seu navegador nao suporta camera.");
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
    alert("Permissao de camera negada ou indisponivel.");
    setStatus("Permissao de camera negada ou indisponivel.");
  }
}

function obterLocalizacao() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocalizacao nao suportada."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
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
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo para validar hash."));
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
  const blob = new Blob([conteudo], { type: "application/json;charset=utf-8" });
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
    const baseDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const hashSobreposicao = await sha256Hex(baseDataUrl);

    const linhasPrincipais = [
      `Data: ${dataHora}`,
      utmTexto
    ];

    const partesHash = hashSobreposicao.match(/.{1,32}/g) || [hashSobreposicao];
    const linhasHash = [
      `Hash: ${partesHash[0]}`,
      ...partesHash.slice(1)
    ];

    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 4;

    const lineHeightPrincipal = 30;
    const lineHeightHash = 22;
    const margem = 22;
    const alturaTexto =
      linhasPrincipais.length * lineHeightPrincipal +
      linhasHash.length * lineHeightHash;
    const yBase = h - margem - alturaTexto;

    let yAtual = yBase;

    ctx.font = "22px system-ui, sans-serif";
    linhasPrincipais.forEach((linha) => {
      ctx.strokeText(linha, margem, yAtual);
      ctx.fillText(linha, margem, yAtual);
      yAtual += lineHeightPrincipal;
    });

    ctx.font = "16px system-ui, sans-serif";
    ctx.lineWidth = 3;
    linhasHash.forEach((linha) => {
      const y = yAtual;
      ctx.strokeText(linha, margem, y);
      ctx.fillText(linha, margem, y);
      yAtual += lineHeightHash;
    });

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
    if (!blob) throw new Error("Falha ao gerar imagem final.");

    let hashArquivoFinal = "";
    try {
      const bufferFinal = await blobParaArrayBuffer(blob);
      hashArquivoFinal = await sha256HexArrayBuffer(bufferFinal);
    } catch (_) {
      hashArquivoFinal = hashSobreposicao;
    }
    lastFilenameBase = `GeoFotoBP-${Date.now()}`;
    lastMetadata = {
      sistema: "GeoFotoBP",
      algoritmo_hash: "SHA-256",
      data_hora: dataHora,
      coordenada_utm: utmCompleta,
      hash_sobreposicao: hashSobreposicao,
      hash_arquivo_final: hashArquivoFinal,
      arquivo_foto: `${lastFilenameBase}.jpg`
    };

    lastBlob = blob;
    resultadoImg.src = URL.createObjectURL(blob);
    hashTexto.textContent =
      `${utmCompleta}\nHash do arquivo final (validacao): ${hashArquivoFinal}\nHash usado na sobreposicao: ${hashSobreposicao}`;
    btnDownload.disabled = false;
    btnComprovante.disabled = false;
    btnShare.disabled = false;
    setStatus("Foto gerada com sucesso.");
  } catch (err) {
    alert(`Nao foi possivel capturar a foto: ${err.message}`);
    setStatus(`Erro: ${err.message}`);
  } finally {
    btnFoto.disabled = false;
  }
}

btnFoto.addEventListener("click", capturarFoto);

btnDownload.addEventListener("click", () => {
  if (!lastBlob) return;
  const nome = `${lastFilenameBase || `GeoFotoBP-${Date.now()}`}.jpg`;
  baixarBlob(lastBlob, nome);
});

btnComprovante.addEventListener("click", () => {
  if (!lastMetadata) return;
  const nome = `${lastFilenameBase || `GeoFotoBP-${Date.now()}`}-comprovante.json`;
  baixarTexto(JSON.stringify(lastMetadata, null, 2), nome);
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
