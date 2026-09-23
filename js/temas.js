// Temas de cores do tabuleiro — pensados para baixa visão: opções de alto
// contraste selecionáveis, aplicadas via variáveis CSS e salvas no aparelho.

export const TEMAS_TABULEIRO = [
  {
    id: 'padrao',
    nome: 'Padrão (cinza-azulado)',
    clara: '#b9c4ce',
    escura: '#5a6b7c',
    selecao: '#ffd75e',
    haloPecas: false,
  },
  {
    id: 'amarelo-preto',
    nome: 'Alto contraste: amarelo e preto',
    clara: '#ffdf33',
    escura: '#000000',
    selecao: '#ff2d2d',
    haloPecas: true, // peças pretas ganham contorno claro para não sumir no preto
  },
  {
    id: 'branco-preto',
    nome: 'Alto contraste: branco e preto',
    clara: '#ffffff',
    escura: '#000000',
    selecao: '#ff8c00',
    haloPecas: true,
  },
  {
    id: 'amarelo-marrom',
    nome: 'Amarelo e marrom escuro',
    clara: '#ffdf7e',
    escura: '#5c3a1e',
    selecao: '#ff2d2d',
    haloPecas: true, // marrom escuro esconderia as peças pretas sem contorno
  },
  {
    id: 'rosa-branco',
    nome: 'Rosa e branco',
    clara: '#ffffff',
    escura: '#e0559b',
    selecao: '#2e6cff',
    haloPecas: false,
  },
  {
    id: 'verde',
    nome: 'Verde clássico',
    clara: '#ebecd0',
    escura: '#779556',
    selecao: '#ffd75e',
    haloPecas: false,
  },
];

export function obterTema(id) {
  return TEMAS_TABULEIRO.find((t) => t.id === id) || TEMAS_TABULEIRO[0];
}

export function aplicarTema(id) {
  const tema = obterTema(id);
  const raiz = document.documentElement.style;
  raiz.setProperty('--casa-clara', tema.clara);
  raiz.setProperty('--casa-escura', tema.escura);
  raiz.setProperty('--cor-selecao', tema.selecao);
  raiz.setProperty(
    '--halo-peca',
    tema.haloPecas
      ? 'drop-shadow(0 0 1px #fff) drop-shadow(0 0 2px rgba(255,255,255,0.8))'
      : 'none',
  );
  return tema;
}

export function preencherSelectDeTemas(select, idAtual) {
  preencherSelect(select, TEMAS_TABULEIRO, idAtual);
}

// ---------------- Coordenadas (letras e números) ----------------

// Onde as coordenadas aparecem. Dentro das casas da borda o tabuleiro fica
// maior; fora, em faixas ao redor, as casas ficam livres para as peças —
// quem enxerga pouco costuma preferir assim.
export const COORDENADAS = [
  { id: 'dentro', nome: 'Dentro das casas da borda (padrão)' },
  { id: 'fora', nome: 'Fora, ao redor do tabuleiro' },
];

export function aplicarCoordenadas(id) {
  const escolha = COORDENADAS.find((c) => c.id === id) || COORDENADAS[0];
  // um atributo na raiz basta: o CSS troca os dois tabuleiros de uma vez,
  // sem remontar nada e sem perder o foco de quem está navegando pelas casas
  document.documentElement.dataset.coordenadas = escolha.id;
  return escolha;
}

export function preencherSelectDeCoordenadas(select, idAtual) {
  preencherSelect(select, COORDENADAS, idAtual);
}

function preencherSelect(select, itens, idAtual) {
  select.textContent = '';
  for (const item of itens) {
    const opcao = document.createElement('option');
    opcao.value = item.id;
    opcao.textContent = item.nome;
    if (item.id === idAtual) opcao.selected = true;
    select.appendChild(opcao);
  }
}
