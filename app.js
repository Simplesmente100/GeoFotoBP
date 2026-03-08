const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const resultadoImg = document.getElementById("resultadoImg");
const hashTexto = document.getElementById("hashTexto");
const btnFoto = document.getElementById("btnFoto");
const btnDownload = document.getElementById("btnDownload");
const btnShare = document.getElementById("btnShare");

let lastBlob = null;

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
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
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

async function sha256Hex(texto) {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
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

    let lat = "indisponivel";
    let lng = "indisponivel";

    try {
      const geo = await obterLocalizacao();
      lat = geo.lat.toFixed(6);
      lng = geo.lng.toFixed(6);
    } catch (_) {
      alert("Permissao de localizacao negada ou indisponivel. A foto sera gerada sem coordenadas precisas.");
    }

    const dataHora = dataHoraBR();
    const baseDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const hashCompleto = await sha256Hex(baseDataUrl);

    const linhas = [
      `Data: ${dataHora}`,
      `GPS: Lat ${lat}, Lng ${lng}`,
      `Hash: ${hashCompleto.slice(0, 10)}`
    ];

    ctx.font = "22px system-ui, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 4;

    const lineHeight = 30;
    const margem = 22;
    const yBase = h - margem - lineHeight * (linhas.length - 1);

    linhas.forEach((linha, i) => {
      const y = yBase + i * lineHeight;
      ctx.strokeText(linha, margem, y);
      ctx.fillText(linha, margem, y);
    });

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
    if (!blob) throw new Error("Falha ao gerar imagem final.");

    lastBlob = blob;
    resultadoImg.src = URL.createObjectURL(blob);
    hashTexto.textContent = `Hash completo para verificacao: ${hashCompleto}`;
    btnDownload.disabled = false;
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
  baixarBlob(lastBlob, `GeoFotoBP-${Date.now()}.jpg`);
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
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}

<<<<<<< HEAD
iniciarCamera();
=======
iniciarCamera();
>>>>>>> 60553b3a2583b9dac78c0db0701deab6efeaa14d
