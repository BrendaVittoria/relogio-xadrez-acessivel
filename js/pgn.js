// Geração do PGN (Seven Tag Roster + Arbiter), download e compartilhamento.

function escaparTag(valor) {
  return valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function tagOuInterrogacao(valor) {
  const limpo = (valor || '').trim();
  return limpo ? escaparTag(limpo) : '?';
}

/**
 * @param {object} dados
 * @param {object} dados.config  {torneio, rodada, mesa, brancas, pretas, arbitro, minutos, incrementoSegundos}
 * @param {string[]} dados.sans  lances em SAN, na ordem
 * @param {Array<{indiceLance:number, texto:string}>} dados.notas  indiceLance = índice do meio-lance (0 = antes do 1º lance)
 * @param {string} dados.resultado '1-0' | '0-1' | '1/2-1/2'
 * @param {Date} dados.data
 */
export function gerarPgn({ config, sans, notas, resultado, data }) {
  const d = data instanceof Date ? data : new Date(data);
  const dataPgn = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const timeControl = `${config.minutos * 60}+${config.incrementoSegundos}`;

  // As sete primeiras são obrigatórias e nessa ordem (Seven Tag Roster); as
  // demais são suplementares e entram depois. Board só sai quando a mesa foi
  // informada: fora de competição por equipes ela não existe, e um "?" fixo
  // seria só ruído no arquivo.
  const tags = [
    `[Event "${tagOuInterrogacao(config.torneio)}"]`,
    `[Site "?"]`,
    `[Date "${dataPgn}"]`,
    `[Round "${tagOuInterrogacao(config.rodada)}"]`,
    `[White "${tagOuInterrogacao(config.brancas)}"]`,
    `[Black "${tagOuInterrogacao(config.pretas)}"]`,
    `[Result "${resultado}"]`,
    `[TimeControl "${timeControl}"]`,
    `[Arbiter "${tagOuInterrogacao(config.arbitro)}"]`,
  ];
  if ((config.mesa || '').trim()) tags.push(`[Board "${escaparTag(config.mesa.trim())}"]`);
  const cabecalho = tags.join('\n');

  // Notas agrupadas por meio-lance (podem existir várias no mesmo lance).
  const notasPorLance = new Map();
  for (const nota of notas || []) {
    const chave = nota.indiceLance;
    if (!notasPorLance.has(chave)) notasPorLance.set(chave, []);
    notasPorLance.get(chave).push(nota.texto.replace(/[{}]/g, ''));
  }

  const tokens = [];
  const notasIniciais = notasPorLance.get(0);
  if (notasIniciais) tokens.push(`{${notasIniciais.join(' — ')}}`);
  sans.forEach((san, i) => {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(san);
    const notasDoLance = notasPorLance.get(i + 1);
    if (notasDoLance) tokens.push(`{${notasDoLance.join(' — ')}}`);
  });
  tokens.push(resultado);

  // Quebra de linha em ~80 colunas, como manda a convenção PGN.
  const linhas = [];
  let linha = '';
  for (const token of tokens) {
    if (linha && linha.length + token.length + 1 > 79) {
      linhas.push(linha);
      linha = token;
    } else {
      linha = linha ? `${linha} ${token}` : token;
    }
  }
  if (linha) linhas.push(linha);

  return `${cabecalho}\n\n${linhas.join('\n')}\n`;
}

// Nome de jogador virando pedaço de nome de arquivo: sem os caracteres que o
// Windows e o Android recusam, sem espaços (viram hífen) e com tamanho limitado.
function nomeParaArquivo(valor) {
  return (valor || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Se os nomes dos jogadores foram preenchidos, o arquivo sai como
 * "Marcelo-versus-Jarbas-2026-07-30-1432.pgn". Com só um nome, vale esse nome
 * sozinho; sem nenhum, continua "partida-...".
 * @param {Date|string|number} data
 * @param {{brancas?:string, pretas?:string}} [config]
 */
export function nomeArquivoPgn(data, config = {}) {
  const d = data instanceof Date ? data : new Date(data);
  const p = (n) => String(n).padStart(2, '0');
  const carimbo = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;

  const brancas = nomeParaArquivo(config.brancas);
  const pretas = nomeParaArquivo(config.pretas);
  let base = 'partida';
  if (brancas && pretas) base = `${brancas}-versus-${pretas}`;
  else if (brancas || pretas) base = brancas || pretas;

  return `${base}-${carimbo}.pgn`;
}

export function baixarPgn(textoPgn, nomeArquivo) {
  const blob = new Blob([textoPgn], { type: 'application/x-chess-pgn' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Devolve o arquivo que o navegador aceita compartilhar, ou null se nenhum.
// No Chrome (Android inclusive), canShare responde que aceita o .pgn, mas o
// share() rejeita a extensão na hora de abrir — a lista fixa de extensões só
// é conferida lá, e .pgn não está nela. Por isso o formato é decidido pela
// família do navegador: Chromium recebe .txt direto (o nome mantém ".pgn" no
// meio para o destinatário saber o que é); Safari aceita o .pgn de verdade.
export function arquivoParaCompartilhar(textoPgn, nomeArquivo) {
  if (!navigator.share || !navigator.canShare) return null;
  const ehChromium = (navigator.userAgentData?.brands || []).some((b) => b.brand.includes('Chromium'))
    || /Chrome|CriOS|Edg/i.test(navigator.userAgent);
  const arquivo = ehChromium
    ? new File([textoPgn], `${nomeArquivo}.txt`, { type: 'text/plain' })
    : new File([textoPgn], nomeArquivo, { type: 'application/x-chess-pgn' });
  return navigator.canShare({ files: [arquivo] }) ? arquivo : null;
}

export async function compartilharPgn(arquivo, titulo) {
  await navigator.share({ files: [arquivo], title: titulo });
}
