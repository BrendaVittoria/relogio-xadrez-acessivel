// Tabela única de comandos especiais — a lista falada pelo "?" sai daqui,
// para nunca ficar dessincronizada da lista implementada.

export const SPECIAL_COMMANDS = [
  { cmd: 't', descricao: 'anuncia o tempo restante de cada jogador' },
  { cmd: 'p', descricao: 'anuncia um resumo da posição atual' },
  { cmd: 'r', descricao: 'repete o último lance anunciado' },
  { cmd: 'm', descricao: 'anuncia o material capturado e a diferença de material' },
  { cmd: 'back', descricao: 'desfaz o último lance, restaurando tabuleiro e relógio; atalho: a, de apagar' },
  { cmd: 'corrigir', descricao: 'substitui um lance já registrado, mantendo o resto da partida; exemplo: corrigir 13 brancas Be4. No tabuleiro, navegue pelo histórico com vírgula e ponto e use a forma curta: corrigir Be4' },
  { cmd: 'revisao', descricao: 'mostra ou esconde os controles de revisão do histórico: lance anterior, próximo lance e ver histórico' },
  { cmd: 'note', descricao: 'registra uma observação do árbitro; o texto vai entre aspas' },
  { cmd: 'modo', descricao: 'alterna entre modo digitação e modo tabuleiro' },
  { cmd: 'som', descricao: 'liga ou desliga o som das peças ao mover' },
  { cmd: 'hold', descricao: 'pausa os dois relógios' },
  { cmd: 'go', descricao: 'inicia o relógio no começo da partida, e retoma os relógios após uma pausa' },
  { cmd: 'draw', descricao: 'registra empate por acordo e encerra a partida' },
  { cmd: 'resign', descricao: 'registra abandono e encerra a partida; sozinho abre a escolha do lado, ou diga direto: resign brancas' },
  { cmd: '?', descricao: 'lê esta lista de comandos' },
];

const COMANDOS_SIMPLES = new Set(
  SPECIAL_COMMANDS.map((c) => c.cmd).filter((c) => c !== 'note' && c !== 'corrigir' && c !== 'resign'),
);

/**
 * Identifica um comando especial na entrada. Deve rodar ANTES do parser de
 * lances, para `note "..."` nunca ser confundido com lance inválido.
 * @returns {{cmd:string, arg?:string, erro?:string} | null}
 */
export function identificarComando(entrada) {
  const texto = entrada.trim();
  const minusculo = texto.toLowerCase();

  if (COMANDOS_SIMPLES.has(minusculo)) return { cmd: minusculo };
  if (minusculo === 'revisão') return { cmd: 'revisao' }; // com acento também vale
  if (minusculo === 'a') return { cmd: 'back' }; // atalho de "apagar" o último lance

  if (/^corrigir\b/i.test(texto)) {
    const completa = texto.match(/^corrigir\s+(\d+)\s+(brancas|pretas)\s+(\S+)\s*$/i);
    if (completa) {
      return {
        cmd: 'corrigir',
        arg: { numero: Number(completa[1]), cor: completa[2].toLowerCase(), texto: completa[3] },
      };
    }
    // forma curta: corrige o lance navegado (vírgula/ponto) ou o último
    const curta = texto.match(/^corrigir\s+(\S+)\s*$/i);
    if (curta) return { cmd: 'corrigir', arg: { texto: curta[1] } };
    return {
      cmd: 'corrigir',
      erro: 'Para corrigir, diga o lance certo (corrigir Be4), ou o número, a cor e o lance (corrigir 13 brancas Be4).',
    };
  }

  if (/^resign\b/i.test(texto)) {
    const m = texto.match(/^resign\s+(brancas|pretas)\s*$/i);
    if (m) return { cmd: 'resign', arg: m[1].toLowerCase() };
    return { cmd: 'resign' }; // sem o lado: abre o diálogo de escolha
  }

  if (/^note\b/i.test(texto)) {
    const m = texto.match(/^note\s+"(.*)"\s*$/is);
    if (m && m[1].trim()) return { cmd: 'note', arg: m[1].trim() };
    return {
      cmd: 'note',
      erro: 'Para registrar uma nota, escreva o texto entre aspas. Exemplo: note "conexão caiu por 2 minutos".',
    };
  }

  return null;
}

export function textoAjuda() {
  const linhas = SPECIAL_COMMANDS.map((c) => {
    const nome = c.cmd === '?' ? 'ponto de interrogação' : c.cmd;
    return `${nome}: ${c.descricao}`;
  });
  return `Comandos disponíveis. ${linhas.join('. ')}.`;
}
