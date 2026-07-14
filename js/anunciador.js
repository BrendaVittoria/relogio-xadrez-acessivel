// Anunciador central: única região aria-live do app + bipes sonoros.
// Centralizar evita anúncios duplicados/concorrentes.

let regiao = null;
let timeoutPendente = null;

export function iniciarAnunciador(elemento) {
  regiao = elemento;
}

export function anunciar(texto) {
  if (!regiao) return;
  // Limpa e regrava com um pequeno atraso para forçar o leitor de tela a
  // reler mesmo quando o texto é idêntico ao anterior.
  if (timeoutPendente) clearTimeout(timeoutPendente);
  regiao.textContent = '';
  timeoutPendente = setTimeout(() => {
    regiao.textContent = texto;
    timeoutPendente = null;
  }, 50);
}

// ---------------- Bipes (Web Audio) ----------------

let audioCtx = null;

function obterContexto() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export function bipe(vezes = 1, frequencia = 880) {
  const ctx = obterContexto();
  if (!ctx) return;
  const duracao = 0.18;
  const intervalo = 0.28;
  for (let i = 0; i < vezes; i++) {
    const inicio = ctx.currentTime + i * intervalo;
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequencia;
    ganho.gain.setValueAtTime(0.0001, inicio);
    ganho.gain.exponentialRampToValueAtTime(0.3, inicio + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
    osc.connect(ganho).connect(ctx.destination);
    osc.start(inicio);
    osc.stop(inicio + duracao + 0.05);
  }
}
