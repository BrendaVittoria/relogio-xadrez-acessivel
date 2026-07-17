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

// "Toc" curto e grave, como peça de madeira pousando no tabuleiro: um
// triângulo com queda rápida de frequência soa percussivo, não musical —
// bem diferente dos bipes de aviso, que são senoides agudas e longas.
function toc(ctx, inicio, frequencia, volume) {
  const osc = ctx.createOscillator();
  const ganho = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequencia, inicio);
  osc.frequency.exponentialRampToValueAtTime(frequencia * 0.45, inicio + 0.07);
  ganho.gain.setValueAtTime(0.0001, inicio);
  ganho.gain.exponentialRampToValueAtTime(volume, inicio + 0.005);
  ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.09);
  osc.connect(ganho).connect(ctx.destination);
  osc.start(inicio);
  osc.stop(inicio + 0.12);
}

// Som de lance: um toc para movimento; captura ganha um segundo toc mais
// agudo logo em seguida (o "clac" da peça capturada saindo). Precisa ser
// agudo: alto-falante de celular não reproduz graves (~abaixo de 300 Hz),
// e com o segundo toc grave captura soava igual a lance comum.
export function somLance(captura = false) {
  const ctx = obterContexto();
  if (!ctx) return;
  const agora = ctx.currentTime;
  toc(ctx, agora, 340, 0.35);
  if (captura) toc(ctx, agora + 0.1, 620, 0.4);
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
