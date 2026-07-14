// Conversão de lances e casas para português falado,
// usando a convenção fonética de casas (anna/bella/cesar/...).

export const NOMES_COLUNAS = {
  a: 'anna', b: 'bella', c: 'cesar', d: 'david',
  e: 'eva', f: 'felix', g: 'gustav', h: 'hector',
};

// nome, artigo definido e gênero de cada peça (chess.js usa letras minúsculas)
export const PECAS = {
  p: { nome: 'peão', artigo: 'o' },
  n: { nome: 'cavalo', artigo: 'o' },
  b: { nome: 'bispo', artigo: 'o' },
  r: { nome: 'torre', artigo: 'a' },
  q: { nome: 'dama', artigo: 'a' },
  k: { nome: 'rei', artigo: 'o' },
};

export const VALOR_PECAS = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// "eva 1": coluna fonética + número em dígito — o leitor de tela fala o
// dígito naturalmente, e o texto fica curto
export function nomeCasa(casa) {
  return `${NOMES_COLUNAS[casa[0]]} ${casa[1]}`;
}

export function nomePeca(letra) {
  return PECAS[letra.toLowerCase()].nome;
}

export function nomeCor(cor) {
  return cor === 'w' ? 'brancas' : 'pretas';
}

// Descreve um lance verboso do chess.js em português por extenso.
// Com `comOrigem`, inclui de onde a peça vem — usado nas perguntas de
// desambiguação (ex.: "peão de bella captura em cesar 3").
// Sem origem, fala no estilo da notação: "cavalo felix 3", sem "para".
export function descreverLance(lance, comOrigem = false) {
  if (lance.san.startsWith('O-O-O')) return 'roque grande';
  if (lance.san.startsWith('O-O')) return 'roque pequeno';

  let peca = nomePeca(lance.piece);
  if (comOrigem) {
    peca += lance.piece === 'p'
      ? ` de ${NOMES_COLUNAS[lance.from[0]]}`
      : ` de ${nomeCasa(lance.from)}`;
  }
  const destino = nomeCasa(lance.to);
  let texto;
  if (lance.captured) {
    const capturada = nomePeca(lance.captured);
    texto = `${peca} toma ${capturada} em ${destino}`;
    if (lance.flags.includes('e')) texto += ', en passant';
  } else {
    // "de X para Y" só quando a origem é falada; sem origem, "cavalo felix 3"
    texto = comOrigem ? `${peca} para ${destino}` : `${peca} ${destino}`;
  }
  if (lance.promotion) {
    texto += `, promove a ${nomePeca(lance.promotion)}`;
  }
  return texto;
}

// Forma falada do dia a dia: lance simples de peão dispensa o nome da peça
// ("eva 4" em vez de "peão eva 4") e peça vai direto ao destino,
// sem "para" ("cavalo felix 3"). Usada nos anúncios de lance aplicado
// e no histórico.
export function descreverLanceFalado(lance) {
  if (lance.san.startsWith('O-O-O')) return 'roque grande';
  if (lance.san.startsWith('O-O')) return 'roque pequeno';

  const destino = nomeCasa(lance.to);
  let texto;
  if (lance.captured) {
    // "dama toma felix 7"; peão identifica-se pela coluna: "eva toma david 5"
    const quem = lance.piece === 'p' ? NOMES_COLUNAS[lance.from[0]] : nomePeca(lance.piece);
    texto = `${quem} toma ${destino}`;
    if (lance.flags.includes('e')) texto += ', en passant';
  } else if (lance.piece === 'p') {
    texto = destino;
  } else {
    texto = `${nomePeca(lance.piece)} ${destino}`;
  }
  if (lance.promotion) {
    texto += `, promove a ${nomePeca(lance.promotion)}`;
  }
  return texto;
}

// Preenche um <ol> de histórico com um item por lance completo (par
// brancas/pretas), na forma fonética: "eva 4, eva 5". O número do lance vem
// da numeração do próprio <ol>; repeti-lo no texto faria o leitor falar "1. 1.".
export function preencherListaLances(lista, lances) {
  lista.textContent = '';
  for (let i = 0; i < lances.length; i += 2) {
    const par = [lances[i], lances[i + 1]].filter(Boolean);
    const item = document.createElement('li');
    item.textContent = par.map((l) => descreverLanceFalado(l) + sufixoXeque(l.san)).join(', ');
    lista.appendChild(item);
  }
}

// Sufixo de xeque para listas de histórico, a partir do SAN.
export function sufixoXeque(san) {
  if (san.endsWith('#')) return ', xeque-mate';
  if (san.endsWith('+')) return ', xeque';
  return '';
}

// Anúncio completo de um lance aplicado: descrição + xeque/xeque-mate.
export function anunciarLanceAplicado(lance, chess) {
  let texto = `${descreverLanceFalado(lance)}.`;
  if (chess.isCheckmate()) {
    texto += ' Xeque-mate!';
  } else if (chess.inCheck()) {
    texto += ' Xeque.';
  }
  return texto;
}

export function tempoFalado(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const partes = [];
  if (h > 0) partes.push(`${h} ${h === 1 ? 'hora' : 'horas'}`);
  if (m > 0) partes.push(`${m} ${m === 1 ? 'minuto' : 'minutos'}`);
  if (s > 0 || partes.length === 0) partes.push(`${s} ${s === 1 ? 'segundo' : 'segundos'}`);
  if (partes.length > 1) {
    const ultima = partes.pop();
    return `${partes.join(', ')} e ${ultima}`;
  }
  return partes[0];
}

export function tempoVisual(ms) {
  // arredonda para cima, como relógio de xadrez físico: só mostra 0:00
  // quando o tempo realmente acabou
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${m}:${dois(s)}`;
}
