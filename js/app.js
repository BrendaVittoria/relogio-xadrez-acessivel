// Orquestração do aplicativo: telas, sala de espera, recuperação de partida,
// tela de resultado (PGN) e registro do service worker.

import { Chess } from '../vendor/chess.js';
import {
  iniciarAnunciador, anunciar, bipe, somLance, precarregarSons,
  somXequeMate, somEmpate, somAvisoTempo,
} from './anunciador.js';
import {
  preencherListaLances, descreverPosicaoBlocos, nomeFormatoDescricao,
} from './fala.js';
import { SPECIAL_COMMANDS } from './comandos.js';
import { Partida } from './jogo.js';
import { gerarPgn, nomeArquivoPgn, baixarPgn, arquivoParaCompartilhar, compartilharPgn } from './pgn.js';
import {
  PRESETS_FIXOS, presetsPromovidos, registrarUsoTempoPersonalizado,
  lerPreferencias, gravarPreferencias,
  lerTemaTabuleiro, gravarTemaTabuleiro,
  lerFormatoDescricao, gravarFormatoDescricao,
  lerPartidaAtual, limparPartidaAtual,
  lerHistorico, adicionarAoHistorico, removerDoHistorico, limparHistorico,
  exportarDados, importarDados,
} from './armazenamento.js';
import { aplicarTema, preencherSelectDeTemas } from './temas.js';

let jogoAtual = null;
let fimAtual = null; // dados da partida encerrada mostrados na tela de resultado
let pgnExportado = false;

const $ = (id) => document.getElementById(id);

// ---------------- telas ----------------

const TELAS = ['tela-recuperacao', 'tela-setup', 'tela-jogo', 'tela-resultado'];

function mostrarTela(id) {
  for (const tela of TELAS) {
    const secao = $(tela);
    if (secao) secao.hidden = tela !== id;
  }
  const titulo = $(id).querySelector('h2');
  if (titulo) {
    titulo.tabIndex = -1;
    titulo.focus();
  }
}

// ---------------- sala de espera ----------------

function rotuloPreset(minutos, incrementoSegundos) {
  const parteMin = minutos % 60 === 0
    ? `${minutos / 60} ${minutos / 60 === 1 ? 'hora' : 'horas'}`
    : `${minutos} minutos`;
  return `${parteMin} + ${incrementoSegundos} segundos de incremento`;
}

function renderizarPresets() {
  const lista = $('lista-presets');
  // A escolha atual tem que sobreviver ao redesenho: um rádio recém-inserido
  // com checked rouba a marcação do grupo, e quem tinha escolhido
  // "Personalizado" voltava ao primeiro preset a cada volta à sala de espera.
  const escolhido = presetSelecionado();
  lista.textContent = '';
  const todos = [
    ...PRESETS_FIXOS.map((p) => ({ ...p, promovido: false })),
    ...presetsPromovidos().map((p) => ({ ...p, promovido: true })),
  ];
  todos.forEach((preset, i) => {
    // Mesmo desenho dos rádios do index.html: input e label irmãos, ligados
    // só por for/id. Input dentro do label é o que o TalkBack lê mal.
    const linha = document.createElement('div');
    linha.className = 'opcao';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'preset-tempo';
    radio.value = `${preset.minutos}+${preset.incrementoSegundos}`;
    radio.id = `preset-tempo-${i}`;
    if (radio.value === escolhido) radio.checked = true;
    const rotulo = document.createElement('label');
    rotulo.htmlFor = radio.id;
    rotulo.textContent =
      `${rotuloPreset(preset.minutos, preset.incrementoSegundos)}${preset.promovido ? ' (preset seu)' : ''}`;
    linha.append(radio, rotulo);
    lista.appendChild(linha);
  });
  // primeira carga, ou preset promovido que saiu da lista: cai no 30+15, o
  // padrão de sempre (a lista começa no 15+10, mas ele não vira o padrão)
  if (!presetSelecionado()) {
    const padrao = lista.querySelector('input[name="preset-tempo"][value="30+15"]')
      || lista.querySelector('input[name="preset-tempo"]');
    if (padrao) padrao.checked = true;
  }
  atualizarCamposPersonalizado();
}

function presetSelecionado() {
  return document.querySelector('input[name="preset-tempo"]:checked')?.value || null;
}

function selecionarTempo(minutos, incrementoSegundos) {
  const valor = `${minutos}+${incrementoSegundos}`;
  const radio = document.querySelector(`input[name="preset-tempo"][value="${valor}"]`);
  if (radio) {
    radio.checked = true;
  } else {
    const personalizado = document.querySelector('input[name="preset-tempo"][value="custom"]');
    personalizado.checked = true;
    $('tempo-minutos').value = minutos;
    $('tempo-incremento').value = incrementoSegundos;
  }
  atualizarCamposPersonalizado();
}

function atualizarCamposPersonalizado() {
  $('campos-personalizado').hidden = presetSelecionado() !== 'custom';
}

function validarAlarmes(texto) {
  const limpo = texto.trim();
  if (!limpo) return { ok: true, valores: [] };
  if (!/^\d+(\s*,\s*\d+)*$/.test(limpo)) {
    return {
      ok: false,
      mensagem: 'Alarmes inválidos: use números inteiros de minutos separados por vírgula, por exemplo 30,15,5.',
    };
  }
  const numeros = limpo.split(',').map((n) => Number(n.trim()));
  if (numeros.some((n) => !Number.isInteger(n) || n <= 0)) {
    return { ok: false, mensagem: 'Alarmes inválidos: cada valor deve ser um número inteiro maior que zero.' };
  }
  // duplicados ignorados, ordem não importa
  return { ok: true, valores: [...new Set(numeros)].sort((a, b) => b - a) };
}

function lerTempoDoFormulario() {
  const preset = presetSelecionado();
  if (preset && preset !== 'custom') {
    const [minutos, incremento] = preset.split('+').map(Number);
    return { ok: true, minutos, incrementoSegundos: incremento };
  }
  const minutos = Number($('tempo-minutos').value);
  const incremento = Number($('tempo-incremento').value);
  if (!Number.isInteger(minutos) || minutos <= 0) {
    return { ok: false, mensagem: 'Informe os minutos por jogador do tempo personalizado (número inteiro maior que zero).' };
  }
  if (!Number.isInteger(incremento) || incremento < 0) {
    return { ok: false, mensagem: 'Informe o incremento em segundos do tempo personalizado (zero ou mais).' };
  }
  return { ok: true, minutos, incrementoSegundos: incremento };
}

function aplicarPreferencias(nome) {
  const prefs = lerPreferencias(nome);
  if (!prefs) return;
  const radioModo = document.querySelector(`input[name="modo-entrada"][value="${prefs.modoEntrada}"]`);
  if (radioModo) radioModo.checked = true;
  if (prefs.minutos) selecionarTempo(prefs.minutos, prefs.incrementoSegundos);
  $('alarmes').value = prefs.alarmes ?? '30,15,5';
  $('som-avisos').checked = prefs.somAtivado !== false;
  $('som-pecas').checked = prefs.somPecas !== false;
  anunciar(`Preferências de ${nome.trim()} carregadas.`);
}

// A partida seguinte é de outras pessoas e de outra rodada: esses campos
// saem para não irem parar no PGN errado. Árbitro e torneio ficam, porque
// valem para o dia inteiro.
function limparIdentificacaoDaPartida() {
  $('nome-brancas').value = '';
  $('nome-pretas').value = '';
  $('rodada').value = '';
  $('mesa').value = '';
}

function aoSubmeterSetup(evento) {
  evento.preventDefault();
  const erroAlarmes = $('alarmes-erro');
  erroAlarmes.hidden = true;

  const alarmes = validarAlarmes($('alarmes').value);
  if (!alarmes.ok) {
    erroAlarmes.textContent = alarmes.mensagem;
    erroAlarmes.hidden = false;
    anunciar(alarmes.mensagem);
    $('alarmes').focus();
    return;
  }

  const tempo = lerTempoDoFormulario();
  if (!tempo.ok) {
    anunciar(tempo.mensagem);
    $('tempo-minutos').focus();
    return;
  }

  const config = {
    modoEntrada: document.querySelector('input[name="modo-entrada"]:checked').value,
    minutos: tempo.minutos,
    incrementoSegundos: tempo.incrementoSegundos,
    arbitro: $('nome-arbitro').value.trim(),
    brancas: $('nome-brancas').value.trim(),
    pretas: $('nome-pretas').value.trim(),
    torneio: $('nome-torneio').value.trim(),
    rodada: $('rodada').value.trim(),
    mesa: $('mesa').value.trim(),
    alarmes: alarmes.valores,
    somAtivado: $('som-avisos').checked,
    somPecas: $('som-pecas').checked,
  };

  if (config.arbitro) {
    gravarPreferencias(config.arbitro, {
      modoEntrada: config.modoEntrada,
      minutos: config.minutos,
      incrementoSegundos: config.incrementoSegundos,
      alarmes: $('alarmes').value.trim(),
      somAtivado: config.somAtivado,
      somPecas: config.somPecas,
    });
  }
  registrarUsoTempoPersonalizado(config.minutos, config.incrementoSegundos);

  iniciarPartida(config);
}

// ---------------- tema do tabuleiro ----------------

function iniciarTemas() {
  const atual = lerTemaTabuleiro();
  aplicarTema(atual);
  for (const id of ['tema-tabuleiro', 'tema-tabuleiro-jogo']) {
    const select = $(id);
    preencherSelectDeTemas(select, atual);
    select.addEventListener('change', () => trocarTema(select.value));
  }
}

function trocarTema(id) {
  const tema = aplicarTema(id);
  gravarTemaTabuleiro(tema.id);
  // manter os dois seletores (sala de espera e painel de ações) em sincronia
  $('tema-tabuleiro').value = tema.id;
  $('tema-tabuleiro-jogo').value = tema.id;
  anunciar(`Cores do tabuleiro: ${tema.nome}.`);
}

// ---------------- descrição da posição (diálogo) ----------------

// FEN da posição que está no diálogo: guardar o texto, e não o objeto do
// jogo, deixa a descrição estável enquanto o diálogo estiver aberto.
let fenDescrito = null;
let formatoDescricao = 'pecas';

// Chamado pelo comando p e pelo botão "Descrever posição" do painel de ações.
function abrirDescricaoPosicao(chess, titulo) {
  fenDescrito = chess.fen();
  $('titulo-descrever').textContent = titulo;
  renderDescricao();
  $('dialogo-descrever').showModal();
  // Foco no título: o conteúdo do diálogo é para ler, então a leitura começa
  // no começo dele, e não no botão do fim.
  $('titulo-descrever').focus();
}

function renderDescricao() {
  if (!fenDescrito) return;
  const blocos = descreverPosicaoBlocos(new Chess(fenDescrito), formatoDescricao);
  const cont = $('blocos-descricao');
  cont.textContent = '';
  for (const bloco of blocos) {
    const p = document.createElement('p');
    p.textContent = bloco;
    cont.appendChild(p);
  }
  // O botão diz para onde ele leva, não onde se está: é o rótulo que funciona
  // sem ver o resto da tela.
  $('btn-formato-descricao').textContent =
    `Mudar para descrição ${nomeFormatoDescricao(outroFormatoDescricao())}`;
}

function outroFormatoDescricao() {
  return formatoDescricao === 'fen' ? 'pecas' : 'fen';
}

function alternarFormatoDescricao() {
  formatoDescricao = outroFormatoDescricao();
  gravarFormatoDescricao(formatoDescricao);
  renderDescricao();
  // Volta ao começo da descrição: o texto todo mudou, e reler do início é o
  // motivo de ter trocado de formato.
  $('titulo-descrever').focus();
}

// ---------------- wake lock: tela acesa durante a partida ----------------

let wakeLock = null;

async function pedirWakeLock() {
  if (!('wakeLock' in navigator)) return; // sem suporte: segue normalmente
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    wakeLock = null; // ex.: economia de bateria ativa — não é erro do app
  }
}

function soltarWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// o sistema solta o wake lock quando a aba sai de cena; readquirir na volta
document.addEventListener('visibilitychange', () => {
  if (
    document.visibilityState === 'visible' &&
    jogoAtual && !jogoAtual.finalizada &&
    !$('tela-jogo').hidden
  ) {
    pedirWakeLock();
  }
});

// ---------------- partida ----------------

function iniciarPartida(config, estadoSalvo = null) {
  if (jogoAtual) jogoAtual.destruir();
  pgnExportado = false;
  fimAtual = null;
  jogoAtual = new Partida({
    config, anunciar, bipe, somLance, somXequeMate, somEmpate, somAvisoTempo,
    aoFim: aoFimDePartida,
    aoDescreverPosicao: abrirDescricaoPosicao,
  });
  mostrarTela('tela-jogo');
  pedirWakeLock();
  if (estadoSalvo) {
    jogoAtual.restaurarDe(estadoSalvo);
  } else {
    jogoAtual.iniciar();
  }
}

function aoFimDePartida(fim) {
  fimAtual = fim;
  pgnExportado = false;
  adicionarAoHistorico(fim);
  soltarWakeLock();
  preencherTelaResultado(fim);
  mostrarTela('tela-resultado');
}

const NOME_RESULTADO = {
  '1-0': 'vitória das Brancas',
  '0-1': 'vitória das Pretas',
  '1/2-1/2': 'empate',
};

function duracaoFalada(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} ${h === 1 ? 'hora' : 'horas'} e ${m} minutos`;
  if (m > 0) return `${m} ${m === 1 ? 'minuto' : 'minutos'}`;
  return 'menos de um minuto';
}

// `sans` guarda meios-lances (cada jogada de brancas ou pretas). Um lance
// completo é o par; a jogada solta das brancas no fim conta como lance também,
// como na numeração do PGN.
function lancesFalados(sans = []) {
  const lances = Math.ceil(sans.length / 2);
  return `${lances} ${lances === 1 ? 'lance' : 'lances'}`;
}

// Torneio, rodada e mesa em uma linha só; vazio quando nenhum dos três foi
// preenchido, para a tela não ganhar um parágrafo sem conteúdo.
function identificacaoDaPartida(config = {}) {
  const partes = [];
  if (config.torneio) partes.push(`Torneio: ${config.torneio}`);
  if (config.rodada) partes.push(`Rodada: ${config.rodada}`);
  if (config.mesa) partes.push(`Mesa: ${config.mesa}`);
  return partes.join(' — ');
}

function preencherTelaResultado(fim) {
  $('resultado-texto').textContent =
    `Resultado: ${fim.resultado.replace('1/2-1/2', '½-½')} — ${NOME_RESULTADO[fim.resultado]}, por ${fim.motivo}.`;
  $('resultado-duracao').textContent =
    `Duração da partida: ${duracaoFalada((fim.encerradaEm || Date.now()) - fim.iniciadaEm)}. ${lancesFalados(fim.sans)}.`;

  const identificacao = $('resultado-identificacao');
  identificacao.textContent = identificacaoDaPartida(fim.config);
  identificacao.hidden = !identificacao.textContent;

  // mesmo formato fonético do histórico da tela de jogo
  const replay = new Chess();
  const lances = fim.sans.map((san) => replay.move(san));
  preencherListaLances($('historico-final'), lances);

  // Compartilhar só aparece se o navegador aceita algum dos formatos (.pgn ou .txt)
  const { texto, nome } = pgnDaPartida(fim);
  const suportaCompartilhar = arquivoParaCompartilhar(texto, nome) !== null;
  $('btn-compartilhar').hidden = !suportaCompartilhar;
  $('aviso-compartilhar').hidden = suportaCompartilhar;
  $('btn-copiar-pgn').hidden = !navigator.clipboard;
  $('aviso-pgn-pendente').hidden = false;
}

function pgnDaPartida(fim) {
  const texto = gerarPgn({
    config: fim.config,
    sans: fim.sans,
    notas: fim.notas,
    resultado: fim.resultado,
    data: new Date(fim.iniciadaEm),
  });
  const nome = nomeArquivoPgn(new Date(fim.iniciadaEm), fim.config);
  return { texto, nome };
}

function marcarPgnExportado() {
  pgnExportado = true;
  limparPartidaAtual();
  $('aviso-pgn-pendente').hidden = true;
}

// ---------------- histórico local de partidas ----------------

function descricaoDePartida(partida) {
  const quando = new Date(partida.iniciadaEm).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const brancas = partida.config.brancas || '?';
  const pretas = partida.config.pretas || '?';
  const resultado = partida.resultado.replace('1/2-1/2', '½-½');
  const onde = [];
  if (partida.config.rodada) onde.push(`rodada ${partida.config.rodada}`);
  if (partida.config.mesa) onde.push(`mesa ${partida.config.mesa}`);
  const lugar = onde.length ? ` — ${onde.join(', ')}` : '';
  return `${quando}${lugar} — ${brancas} contra ${pretas} — ${resultado}, por ${partida.motivo}, ${lancesFalados(partida.sans)}`;
}

function renderizarHistorico() {
  const historico = lerHistorico();
  const lista = $('lista-historico');
  lista.textContent = '';
  $('historico-vazio').hidden = historico.length > 0;
  $('btn-limpar-historico').hidden = historico.length === 0;

  for (const partida of historico) {
    const item = document.createElement('li');
    const descricao = descricaoDePartida(partida);
    const texto = document.createElement('span');
    texto.textContent = descricao;
    item.appendChild(texto);

    const botao = (rotulo, ariaLabel, aoClicar) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = rotulo;
      b.setAttribute('aria-label', ariaLabel);
      b.addEventListener('click', aoClicar);
      return b;
    };

    // Um botão só por partida abre as ações: a lista fica curta de navegar,
    // em vez de quatro botões por item entre uma partida e a seguinte.
    const acoes = document.createElement('span');
    acoes.className = 'acoes-linha';
    acoes.hidden = true;

    const btnOpcoes = botao('Ver opções', `Opções da partida de ${descricao}`, () => {
      const mostrar = acoes.hidden;
      acoes.hidden = !mostrar;
      btnOpcoes.setAttribute('aria-expanded', String(mostrar));
      btnOpcoes.textContent = mostrar ? 'Ocultar opções' : 'Ver opções';
    });
    btnOpcoes.setAttribute('aria-expanded', 'false');
    item.appendChild(btnOpcoes);

    acoes.appendChild(botao('Baixar PGN', `Baixar PGN da partida de ${descricao}`, () => {
      const { texto: pgn, nome } = pgnDaPartida(partida);
      baixarPgn(pgn, nome);
      anunciar('PGN baixado.');
    }));

    // Compartilhar e Copiar seguem as mesmas condições da tela de resultado:
    // só aparecem quando o navegador aceita o recurso.
    const { texto: pgn, nome } = pgnDaPartida(partida);
    if (arquivoParaCompartilhar(pgn, nome) !== null) {
      acoes.appendChild(botao('Compartilhar', `Compartilhar a partida de ${descricao}`, async () => {
        const arquivo = arquivoParaCompartilhar(pgn, nome);
        if (!arquivo) return;
        try {
          await compartilharPgn(arquivo, 'Partida de xadrez (PGN)');
          anunciar('PGN compartilhado.');
        } catch (erro) {
          if (erro.name !== 'AbortError') {
            anunciar('Não foi possível compartilhar. Use o botão Baixar PGN.');
          }
        }
      }));
    }
    if (navigator.clipboard) {
      acoes.appendChild(botao('Copiar PGN', `Copiar PGN da partida de ${descricao}`, async () => {
        try {
          await navigator.clipboard.writeText(pgn);
          anunciar('PGN copiado para a área de transferência.');
        } catch {
          anunciar('Não foi possível copiar. Use o botão Baixar PGN.');
        }
      }));
    }

    acoes.appendChild(botao('Apagar', `Apagar do histórico a partida de ${descricao}`, () => {
      removerDoHistorico(partida.iniciadaEm);
      renderizarHistorico();
      anunciar('Partida apagada do histórico.');
    }));
    item.appendChild(acoes);
    lista.appendChild(item);
  }
}

// ---------------- recuperação ----------------

function verificarRecuperacao() {
  const salvo = lerPartidaAtual();
  if (!salvo || !salvo.config) {
    mostrarTela('tela-setup');
    return;
  }
  const quando = new Date(salvo.iniciadaEm).toLocaleString('pt-BR');
  const lances = lancesFalados(salvo.sans);
  if (salvo.finalizada && salvo.resultado) {
    $('titulo-recuperacao').textContent = 'Partida encerrada sem PGN baixado';
    $('recuperacao-descricao').textContent =
      `Existe uma partida encerrada (iniciada em ${quando}, ${lances}, resultado ${salvo.resultado}) cujo PGN ainda não foi baixado nem compartilhado. Deseja abrir a tela de resultado para baixá-lo?`;
    $('btn-recuperar').textContent = 'Abrir tela de resultado';
  } else {
    $('titulo-recuperacao').textContent = 'Partida em andamento encontrada';
    $('recuperacao-descricao').textContent =
      `Existe uma partida em andamento (iniciada em ${quando}, ${lances}). Deseja continuar essa partida?`;
    $('btn-recuperar').textContent = 'Continuar a partida';
  }
  mostrarTela('tela-recuperacao');
}

function recuperarPartida() {
  const salvo = lerPartidaAtual();
  if (!salvo || !salvo.config) {
    mostrarTela('tela-setup');
    return;
  }
  if (salvo.finalizada && salvo.resultado) {
    fimAtual = {
      resultado: salvo.resultado,
      motivo: salvo.motivo || 'outro',
      sans: salvo.sans || [],
      notas: salvo.notas || [],
      config: salvo.config,
      iniciadaEm: salvo.iniciadaEm,
      encerradaEm: salvo.encerradaEm || Date.now(),
    };
    pgnExportado = false;
    adicionarAoHistorico(fimAtual); // caso o app tenha fechado antes de registrar
    preencherTelaResultado(fimAtual);
    mostrarTela('tela-resultado');
  } else {
    iniciarPartida(salvo.config, salvo);
  }
}

// ---------------- ligações de eventos (uma única vez) ----------------

function ligarEventos() {
  // sala de espera
  $('form-setup').addEventListener('submit', aoSubmeterSetup);
  $('form-setup').addEventListener('change', (e) => {
    if (e.target.name === 'preset-tempo') atualizarCamposPersonalizado();
  });
  $('nome-arbitro').addEventListener('change', (e) => aplicarPreferencias(e.target.value));

  // backup local
  $('btn-exportar-dados').addEventListener('click', () => {
    const json = exportarDados();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const hoje = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `backup-relogio-xadrez-${hoje}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    anunciar('Backup dos dados locais baixado.');
  });
  $('btn-importar-dados').addEventListener('click', () => $('arquivo-importar').click());
  $('arquivo-importar').addEventListener('change', async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    try {
      const quantidade = importarDados(await arquivo.text());
      renderizarPresets();
      renderizarHistorico();
      anunciar(`Dados importados: ${quantidade} ${quantidade === 1 ? 'registro' : 'registros'}.`);
    } catch (erro) {
      anunciar(`Falha ao importar: ${erro.message}`);
    }
  });

  // recuperação
  $('btn-recuperar').addEventListener('click', recuperarPartida);
  $('btn-descartar-recuperacao').addEventListener('click', () => {
    limparPartidaAtual();
    anunciar('Partida salva descartada.');
    mostrarTela('tela-setup');
  });

  // tela de jogo: entrada por digitação
  $('entrada').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && jogoAtual) {
      e.preventDefault();
      jogoAtual.processarEntradaTexto(e.target.value);
    }
  });

  // botão visível de iniciar/retomar o relógio (some enquanto ele corre)
  $('btn-comecar').addEventListener('click', () => {
    if (!jogoAtual) return;
    jogoAtual.executarComando('go');
    jogoAtual.focarEntradaAtiva();
  });

  // lista visível de comandos no modo digitação
  const listaComandos = $('lista-comandos');
  for (const comando of SPECIAL_COMMANDS) {
    const item = document.createElement('li');
    item.textContent = `${comando.cmd === '?' ? 'ponto de interrogação (?)' : comando.cmd}: ${comando.descricao}`;
    listaComandos.appendChild(item);
  }
  $('btn-ver-comandos').addEventListener('click', (e) => {
    const mostrar = listaComandos.hidden;
    listaComandos.hidden = !mostrar;
    e.target.setAttribute('aria-expanded', String(mostrar));
    e.target.textContent = mostrar ? 'Ocultar comandos' : 'Ver comandos';
  });

  // navegação pelo histórico por toque (modo tabuleiro)
  $('btn-lance-anterior').addEventListener('click', () => {
    if (jogoAtual) jogoAtual.navegarHistorico(-1);
  });
  $('btn-lance-proximo').addEventListener('click', () => {
    if (jogoAtual) jogoAtual.navegarHistorico(1);
  });

  // histórico recolhido no modo tabuleiro
  $('btn-ver-historico').addEventListener('click', (e) => {
    const area = $('area-historico');
    const mostrar = area.hidden;
    area.hidden = !mostrar;
    e.target.setAttribute('aria-expanded', String(mostrar));
    e.target.textContent = mostrar ? 'Ocultar histórico' : 'Ver histórico';
  });

  // tabuleiro do modo digitação (aceita lances por toque também)
  $('btn-mostrar-tabuleiro').addEventListener('click', (e) => {
    const alvo = $('tabuleiro-digitacao');
    const mostrar = alvo.hidden;
    alvo.hidden = !mostrar;
    e.target.setAttribute('aria-expanded', String(mostrar));
    e.target.textContent = mostrar ? 'Ocultar tabuleiro' : 'Mostrar tabuleiro';
    if (mostrar && jogoAtual) jogoAtual.tabuleiroDigitacao.atualizar();
  });

  // painel de ações do modo tabuleiro
  $('btn-acoes').addEventListener('click', (e) => {
    const painel = $('painel-acoes');
    const mostrar = painel.hidden;
    painel.hidden = !mostrar;
    e.target.setAttribute('aria-expanded', String(mostrar));
    e.target.textContent = mostrar ? 'Ocultar ações' : 'Ver ações';
  });

  $('painel-acoes').addEventListener('click', (e) => {
    const botao = e.target.closest('button[data-acao]');
    if (!botao || !jogoAtual) return;
    const acao = botao.dataset.acao;
    if (acao === 'holdgo') {
      jogoAtual.executarComando(jogoAtual.relogio.pausado ? 'go' : 'hold');
    } else if (acao === 'end') {
      $('dialogo-encerrar').showModal();
    } else if (acao === 'corrigir') {
      // o comando precisa do lance: pré-preenche a caixa para completar
      jogoAtual.prepararCorrecao();
    } else {
      jogoAtual.executarComando(acao, botao.dataset.arg);
    }
  });

  $('btn-registrar-nota').addEventListener('click', () => {
    if (!jogoAtual) return;
    jogoAtual.registrarNota($('campo-nota').value);
    $('campo-nota').value = '';
  });

  // barra de espaço fora de campos interativos alterna o relógio
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || !jogoAtual || $('tela-jogo').hidden) return;
    const alvo = e.target;
    if (alvo.closest('input, textarea, select, button, dialog[open], [role="dialog"]')) return;
    e.preventDefault();
    jogoAtual.alternarRelogio();
  });

  // diálogo de promoção (modo tabuleiro)
  const dialogoPromocao = $('dialogo-promocao');
  dialogoPromocao.addEventListener('click', (e) => {
    const botao = e.target.closest('button[data-promocao]');
    if (!botao || !jogoAtual) return;
    dialogoPromocao.close('escolhida');
    jogoAtual.confirmarPromocaoTabuleiro(botao.dataset.promocao);
  });
  $('btn-cancelar-promocao').addEventListener('click', () => dialogoPromocao.close('cancelada'));
  dialogoPromocao.addEventListener('close', () => {
    if (dialogoPromocao.returnValue !== 'escolhida' && jogoAtual) {
      jogoAtual.cancelarPromocaoTabuleiro();
    }
    dialogoPromocao.returnValue = '';
  });

  // diálogo de encerramento manual
  const dialogoEncerrar = $('dialogo-encerrar');
  $('form-encerrar').addEventListener('submit', (e) => {
    e.preventDefault();
    const resultado = document.querySelector('input[name="resultado-manual"]:checked');
    if (!resultado) {
      anunciar('Escolha o resultado da partida antes de confirmar.');
      return;
    }
    const motivo = document.querySelector('input[name="motivo-manual"]:checked')?.value || 'outro';
    dialogoEncerrar.close('confirmado');
    if (jogoAtual) jogoAtual.encerrarManual(resultado.value, motivo);
  });
  $('btn-cancelar-encerrar').addEventListener('click', () => dialogoEncerrar.close('cancelado'));

  // diálogo da descrição da posição
  $('btn-formato-descricao').addEventListener('click', alternarFormatoDescricao);
  $('btn-fechar-descrever').addEventListener('click', () => $('dialogo-descrever').close());

  // diálogo de abandono: escolha do lado que abandona
  const dialogoAbandono = $('dialogo-abandono');
  dialogoAbandono.addEventListener('click', (e) => {
    const botao = e.target.closest('button[data-abandono]');
    if (!botao || !jogoAtual) return;
    dialogoAbandono.close('escolhido');
    jogoAtual.executarComando('resign', botao.dataset.abandono);
  });
  $('btn-cancelar-abandono').addEventListener('click', () => dialogoAbandono.close('cancelado'));

  // tela de resultado
  $('btn-baixar-pgn').addEventListener('click', () => {
    if (!fimAtual) return;
    const { texto, nome } = pgnDaPartida(fimAtual);
    baixarPgn(texto, nome);
    marcarPgnExportado();
    anunciar('PGN baixado.');
  });

  $('btn-compartilhar').addEventListener('click', async () => {
    if (!fimAtual) return;
    const { texto, nome } = pgnDaPartida(fimAtual);
    const arquivo = arquivoParaCompartilhar(texto, nome);
    if (!arquivo) return;
    try {
      await compartilharPgn(arquivo, 'Partida de xadrez (PGN)');
      marcarPgnExportado();
      anunciar('PGN compartilhado.');
    } catch (erro) {
      if (erro.name !== 'AbortError') {
        anunciar('Não foi possível compartilhar. Use o botão Baixar PGN.');
      }
    }
  });

  $('btn-copiar-pgn').addEventListener('click', async () => {
    if (!fimAtual) return;
    const { texto } = pgnDaPartida(fimAtual);
    try {
      await navigator.clipboard.writeText(texto);
      anunciar('PGN copiado para a área de transferência.');
    } catch {
      anunciar('Não foi possível copiar. Use o botão Baixar PGN.');
    }
  });

  $('btn-nova-partida').addEventListener('click', () => {
    // a partida encerrada já está no histórico local — nada se perde aqui
    limparPartidaAtual();
    if (jogoAtual) {
      jogoAtual.destruir();
      jogoAtual = null;
    }
    fimAtual = null;
    limparIdentificacaoDaPartida();
    renderizarPresets();
    renderizarHistorico();
    mostrarTela('tela-setup');
    anunciar('Sala de espera. Configure a próxima partida.');
  });

  $('btn-limpar-historico').addEventListener('click', () => {
    if (!window.confirm('Apagar todo o histórico de partidas deste aparelho? Essa ação não pode ser desfeita.')) return;
    limparHistorico();
    renderizarHistorico();
    anunciar('Histórico de partidas apagado.');
  });
}

// ---------------- inicialização ----------------

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // updateViaCache: 'none' impede que o próprio sw.js venha do cache HTTP, e o
  // update() a cada abertura faz o app buscar uma versão nova assim que ela é
  // publicada, em vez de esperar a checagem automática do navegador
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then((registro) => registro.update())
    .catch(() => {
      // sem service worker o app continua funcionando online
    });
}

// Descarta o app guardado no aparelho (cache + service worker) e recarrega da
// rede. É a saída para quem ficou com uma cópia offline defeituosa.
async function reinstalarApp(apagarDados) {
  if (apagarDados) {
    try { localStorage.clear(); } catch { /* modo privado bloqueia */ }
  }
  try {
    if ('caches' in window) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map((chave) => caches.delete(chave)));
    }
  } catch { /* segue mesmo assim: o unregister abaixo já ajuda */ }
  try {
    if ('serviceWorker' in navigator) {
      const registros = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registros.map((registro) => registro.unregister()));
    }
  } catch { /* idem */ }
  location.reload();
}

// Toda tela nasce com hidden no HTML e quem revela a primeira é o JavaScript:
// se a inicialização quebrar, o usuário fica olhando uma página vazia, sem
// saber o que houve nem como sair. Este painel é montado inteiramente em JS,
// sem depender de elemento do index.html nem de classe do styles.css, porque
// são justamente esses arquivos que podem estar com problema.
function mostrarFalhaDeInicializacao(erro) {
  const painel = document.createElement('section');
  painel.setAttribute('role', 'alert');
  painel.style.cssText = 'max-width:40rem;margin:1rem auto;padding:1rem;line-height:1.5';

  const titulo = document.createElement('h2');
  titulo.textContent = 'O aplicativo não conseguiu abrir';
  titulo.tabIndex = -1;

  const texto = document.createElement('p');
  texto.textContent = 'Provavelmente a cópia guardada neste aparelho para uso '
    + 'offline está incompleta. Baixar o aplicativo de novo costuma resolver. '
    + 'Suas partidas salvas serão mantidas.';

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.textContent = 'Baixar o aplicativo de novo e recarregar';
  botao.style.cssText = 'font-size:1rem;padding:0.75rem 1rem;margin:0.5rem 0';
  botao.addEventListener('click', () => {
    botao.disabled = true;
    botao.textContent = 'Baixando…';
    reinstalarApp(false);
  });

  const apagar = document.createElement('button');
  apagar.type = 'button';
  apagar.textContent = 'Se não resolver: apagar também os dados salvos';
  apagar.style.cssText = 'font-size:0.9rem;padding:0.5rem;display:block;margin-top:0.5rem';
  apagar.addEventListener('click', () => {
    const certeza = confirm('Isso apaga o histórico de partidas e qualquer partida '
      + 'em andamento guardados neste aparelho. Continuar?');
    if (certeza) reinstalarApp(true);
  });

  const detalhe = document.createElement('p');
  detalhe.style.cssText = 'font-size:0.85rem;opacity:0.8;margin-top:1rem';
  detalhe.textContent = `Detalhe técnico: ${(erro && erro.message) || erro}`;

  painel.append(titulo, texto, botao, apagar, detalhe);
  document.body.appendChild(painel);
  titulo.focus();
}

function iniciarApp() {
  // registrado antes de tudo: mesmo que a inicialização quebre, o service
  // worker fica instalado e busca a correção na próxima abertura com internet
  registrarServiceWorker();

  try {
    iniciarAnunciador($('anunciador'));
    iniciarTemas();
    formatoDescricao = lerFormatoDescricao();
    renderizarPresets();
    renderizarHistorico();
    atualizarCamposPersonalizado();
    ligarEventos();
    verificarRecuperacao();

    // O navegador só libera áudio depois de um gesto do usuário; o primeiro
    // toque/tecla também é a deixa para baixar e decodificar as amostras, bem
    // antes do primeiro lance.
    const prepararAudio = () => precarregarSons();
    document.addEventListener('pointerdown', prepararAudio, { once: true });
    document.addEventListener('keydown', prepararAudio, { once: true });
  } catch (erro) {
    mostrarFalhaDeInicializacao(erro);
  }
}

iniciarApp();
