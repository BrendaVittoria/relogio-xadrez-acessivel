// Persistência local (localStorage): preferências por árbitro, contadores de
// tempos personalizados, recuperação de partida e backup exportável.

const PREFIXO = 'relogio-xadrez.';

function ler(chave, padrao = null) {
  try {
    const bruto = localStorage.getItem(PREFIXO + chave);
    return bruto === null ? padrao : JSON.parse(bruto);
  } catch {
    return padrao;
  }
}

function gravar(chave, valor) {
  try {
    localStorage.setItem(PREFIXO + chave, JSON.stringify(valor));
  } catch {
    // armazenamento cheio/indisponível: seguir sem persistir
  }
}

function remover(chave) {
  try {
    localStorage.removeItem(PREFIXO + chave);
  } catch { /* ignorar */ }
}

// ---------------- Preferências por árbitro ----------------

function chavePrefs(nomeArbitro) {
  return `prefs.${nomeArbitro.trim().toLowerCase()}`;
}

export function lerPreferencias(nomeArbitro) {
  if (!nomeArbitro || !nomeArbitro.trim()) return null;
  return ler(chavePrefs(nomeArbitro));
}

export function gravarPreferencias(nomeArbitro, prefs) {
  if (!nomeArbitro || !nomeArbitro.trim()) return;
  gravar(chavePrefs(nomeArbitro), prefs);
}

// ---------------- Presets promovidos (por dispositivo) ----------------

export const PRESETS_FIXOS = [
  { minutos: 30, incrementoSegundos: 15 },
  { minutos: 45, incrementoSegundos: 30 },
  { minutos: 60, incrementoSegundos: 30 },
];

const LIMIAR_PROMOCAO = 5;

function ehPresetFixo(minutos, incrementoSegundos) {
  return PRESETS_FIXOS.some(
    (p) => p.minutos === minutos && p.incrementoSegundos === incrementoSegundos,
  );
}

export function registrarUsoTempoPersonalizado(minutos, incrementoSegundos) {
  if (ehPresetFixo(minutos, incrementoSegundos)) return;
  const usos = ler('usos-tempos', {});
  const chave = `${minutos}+${incrementoSegundos}`;
  usos[chave] = (usos[chave] || 0) + 1;
  gravar('usos-tempos', usos);
}

export function presetsPromovidos() {
  const usos = ler('usos-tempos', {});
  const promovidos = [];
  for (const [chave, contagem] of Object.entries(usos)) {
    if (contagem >= LIMIAR_PROMOCAO) {
      const [minutos, incrementoSegundos] = chave.split('+').map(Number);
      if (!ehPresetFixo(minutos, incrementoSegundos)) {
        promovidos.push({ minutos, incrementoSegundos });
      }
    }
  }
  promovidos.sort((a, b) => a.minutos - b.minutos || a.incrementoSegundos - b.incrementoSegundos);
  return promovidos;
}

// ---------------- Tema do tabuleiro ----------------

export function lerTemaTabuleiro() {
  return ler('tema-tabuleiro', 'padrao');
}

export function gravarTemaTabuleiro(id) {
  gravar('tema-tabuleiro', id);
}

// ---------------- Partida em andamento (recuperação) ----------------

export function gravarPartidaAtual(estado) {
  gravar('partida-atual', estado);
}

export function lerPartidaAtual() {
  return ler('partida-atual');
}

export function limparPartidaAtual() {
  remover('partida-atual');
}

// ---------------- Histórico local de partidas ----------------

// Teto para não sobrecarregar o localStorage: ~50 partidas ≈ poucas centenas
// de KB. Ao passar do limite, as mais antigas saem primeiro.
const LIMITE_HISTORICO = 50;

export function lerHistorico() {
  return ler('historico', []);
}

export function adicionarAoHistorico(partida) {
  const historico = lerHistorico();
  // se a mesma partida já está lá (ex.: recuperação após travamento), substitui
  const indice = historico.findIndex((p) => p.iniciadaEm === partida.iniciadaEm);
  if (indice >= 0) {
    historico[indice] = partida;
  } else {
    historico.unshift(partida);
  }
  gravar('historico', historico.slice(0, LIMITE_HISTORICO));
}

export function removerDoHistorico(iniciadaEm) {
  const historico = lerHistorico().filter((p) => p.iniciadaEm !== iniciadaEm);
  gravar('historico', historico);
}

export function limparHistorico() {
  remover('historico');
}

// ---------------- Backup (exportar/importar tudo) ----------------

export function exportarDados() {
  const dados = {};
  for (let i = 0; i < localStorage.length; i++) {
    const chave = localStorage.key(i);
    if (chave && chave.startsWith(PREFIXO)) {
      try {
        dados[chave] = JSON.parse(localStorage.getItem(chave));
      } catch { /* pular valor corrompido */ }
    }
  }
  return JSON.stringify(
    { app: 'relogio-xadrez-acessivel', versao: 1, exportadoEm: new Date().toISOString(), dados },
    null,
    2,
  );
}

export function importarDados(json) {
  const pacote = JSON.parse(json);
  if (!pacote || pacote.app !== 'relogio-xadrez-acessivel' || !pacote.dados) {
    throw new Error('Arquivo não reconhecido como backup deste aplicativo.');
  }
  let quantidade = 0;
  for (const [chave, valor] of Object.entries(pacote.dados)) {
    if (chave.startsWith(PREFIXO)) {
      localStorage.setItem(chave, JSON.stringify(valor));
      quantidade++;
    }
  }
  return quantidade;
}
