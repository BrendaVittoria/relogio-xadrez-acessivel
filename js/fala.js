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

export function adjetivoCor(letraPeca, cor) {
  const feminino = PECAS[letraPeca.toLowerCase()].artigo === 'a';
  if (cor === 'w') return feminino ? 'branca' : 'branco';
  return feminino ? 'preta' : 'preto';
}

export function artigoIndefinido(letraPeca) {
  return PECAS[letraPeca.toLowerCase()].artigo === 'a' ? 'uma' : 'um';
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

// ---------------- Descrição de posição (por blocos) ----------------
// Mesma descrição do leitor de PGN: em vez de um anúncio único e comprido,
// a posição sai em frases curtas que o leitor de tela percorre no ritmo de
// quem lê.

const ORDEM_PECAS = ['k', 'q', 'r', 'b', 'n', 'p'];
const PLURAIS = {
  k: 'rei', q: 'dama', r: 'torres', b: 'bispos', n: 'cavalos', p: 'peões',
};
const SINGULARES = {
  k: 'rei', q: 'dama', r: 'torre', b: 'bispo', n: 'cavalo', p: 'peão',
};

// Junta "anna 1", "bella 2", "cesar 3" com vírgulas e "e" no fim.
function juntarCasas(casas) {
  if (casas.length === 1) return casas[0];
  const inicio = casas.slice(0, -1).join(', ');
  return `${inicio} e ${casas[casas.length - 1]}`;
}

// Teto de peças por linha da descrição. Acima disso a linha vira uma lista
// comprida que o leitor de tela despeja de uma vez só — e quem ouve perde a
// conta no meio. Com oito peões saem três linhas: 3, 3 e 2.
const PECAS_POR_LINHA = 3;

function fatiar(lista, tamanho = PECAS_POR_LINHA) {
  const fatias = [];
  for (let i = 0; i < lista.length; i += tamanho) {
    fatias.push(lista.slice(i, i + tamanho));
  }
  return fatias;
}

// Os dois formatos da descrição. "Peças" agrupa por tipo de peça (é como se
// fala de uma posição); "fileira" percorre o tabuleiro de cima para baixo,
// da fileira 8 à 1, na mesma ordem em que o FEN é escrito.
export const FORMATOS_DESCRICAO = [
  { id: 'pecas', nome: 'por peça' },
  { id: 'fen', nome: 'por fileira, como o FEN' },
];

export function nomeFormatoDescricao(id) {
  const f = FORMATOS_DESCRICAO.find((x) => x.id === id);
  return (f || FORMATOS_DESCRICAO[0]).nome;
}

// Constrói a lista de blocos de texto para o diálogo "Descrever posição".
export function descreverPosicaoBlocos(chess, formato = 'pecas') {
  const blocos = formato === 'fen' ? blocosPorFileira(chess) : blocosPorPeca(chess);
  blocos.push(...blocosDeContexto(chess));
  return blocos;
}

// Formato "por peça": um bloco com a cor, e depois uma linha por tipo de
// peça — quebrada em várias quando passa do teto de peças por linha.
function blocosPorPeca(chess) {
  const board = chess.board(); // matriz 8x8, [0]=linha 8
  const porCor = { w: {}, b: {} };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const casa = board[r][c];
      if (!casa) continue;
      const linha = 8 - r;
      const coluna = 'abcdefgh'[c];
      const nome = `${NOMES_COLUNAS[coluna]} ${linha}`;
      // sem ||= : a atribuição lógica só existe a partir do Chrome 85, e por
      // ser sintaxe nova ela impede o arquivo INTEIRO de carregar em navegador
      // antigo — o app nem abre, em vez de falhar só aqui
      const doTipo = porCor[casa.color][casa.type] || (porCor[casa.color][casa.type] = []);
      doTipo.push({ nome, ord: c * 8 + linha });
    }
  }

  const blocos = [];
  for (const cor of ['w', 'b']) {
    blocos.push(cor === 'w' ? 'Brancas:' : 'Pretas:');
    let alguma = false;
    for (const tipo of ORDEM_PECAS) {
      const lista = porCor[cor][tipo];
      if (!lista || !lista.length) continue;
      alguma = true;
      lista.sort((a, b) => a.ord - b.ord);
      const rotulo = lista.length === 1 ? SINGULARES[tipo] : PLURAIS[tipo];
      // O rótulo sai uma vez só: as linhas seguintes do mesmo tipo são a
      // continuação da lista de casas, e repetir "peões" três vezes é fala
      // sobrando no meio do que interessa.
      fatiar(lista.map((x) => x.nome)).forEach((fatia, i) => {
        blocos.push(i === 0 ? `${rotulo} ${juntarCasas(fatia)}.` : `${juntarCasas(fatia)}.`);
      });
    }
    if (!alguma) blocos.push('Sem peças.');
  }
  return blocos;
}

// Formato "por fileira": da fileira 8 para a 1, cada uma lida da coluna anna
// à hector — a mesma varredura do FEN. Quando as peças da linha são todas da
// mesma cor, a cor sai uma vez no começo em vez de grudar em cada peça.
function blocosPorFileira(chess) {
  const board = chess.board();
  const blocos = [];
  for (let r = 0; r < 8; r++) {
    const linha = 8 - r;
    const pecas = [];
    for (let c = 0; c < 8; c++) {
      const casa = board[r][c];
      if (!casa) continue;
      pecas.push({
        tipo: casa.type,
        cor: casa.color,
        nome: `${NOMES_COLUNAS['abcdefgh'[c]]} ${linha}`,
      });
    }
    if (!pecas.length) {
      blocos.push(`Fileira ${linha}: vazia.`);
      continue;
    }
    // Nada de rótulo repetido: "Fileira 8" sai uma vez só, na primeira linha
    // dela, e o nome da peça sai uma vez por corrida de peças iguais. As
    // linhas seguintes são a continuação da mesma lista — quem ouve já sabe
    // em que fileira está e de que peça se fala.
    let corrida = null; // tipo cujo nome já foi dito e ainda vale
    fatiar(pecas).forEach((fatia, i) => {
      const umaCor = fatia.every((p) => p.cor === fatia[0].cor);
      const umTipo = umaCor && fatia.every((p) => p.tipo === fatia[0].tipo);
      let corpo;
      if (umTipo && corrida === fatia[0].tipo) {
        corpo = juntarCasas(fatia.map((p) => p.nome));
      } else if (umTipo && fatia.length > 1) {
        // Três peões seguidos viram "peões anna 7, bella 7 e cesar 7" em vez
        // de repetir "peão" três vezes — é assim que se fala uma linha deles.
        corpo = `${PLURAIS[fatia[0].tipo]} ${juntarCasas(fatia.map((p) => p.nome))}`;
        corrida = fatia[0].tipo;
      } else {
        corpo = juntarCasas(fatia.map((p) => (umaCor
          ? `${SINGULARES[p.tipo]} ${p.nome}`
          : `${SINGULARES[p.tipo]} ${adjetivoCor(p.tipo, p.cor)} ${p.nome}`)));
        corrida = null;
      }
      if (i > 0) blocos.push(`${corpo}.`);
      else if (umaCor) blocos.push(`Fileira ${linha}, ${nomeCor(fatia[0].cor)}: ${corpo}.`);
      else blocos.push(`Fileira ${linha}: ${corpo}.`);
    });
  }
  return blocos;
}

// Vez, direitos de roque e xeque: iguais nos dois formatos.
function blocosDeContexto(chess) {
  const blocos = [`Vez das ${nomeCor(chess.turn())}.`];
  const roques = [];
  const direitos = obterRoques(chess);
  if (direitos.w.length) roques.push(`Brancas podem rocar: ${direitos.w.join(' e ')}`);
  if (direitos.b.length) roques.push(`Pretas podem rocar: ${direitos.b.join(' e ')}`);
  if (roques.length) blocos.push(`${roques.join('. ')}.`);
  if (chess.isCheckmate()) blocos.push('Xeque-mate.');
  else if (chess.inCheck()) blocos.push(`${nomeCor(chess.turn())} em xeque.`);
  return blocos;
}

function obterRoques(chess) {
  const campo = chess.fen().split(' ')[2] || '-';
  const w = [];
  const b = [];
  if (campo.includes('K')) w.push('pequeno');
  if (campo.includes('Q')) w.push('grande');
  if (campo.includes('k')) b.push('pequeno');
  if (campo.includes('q')) b.push('grande');
  return { w, b };
}
