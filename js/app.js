// Orquestração do aplicativo: telas, sala de espera, recuperação de partida,
// tela de resultado (PGN) e registro do service worker.

import { Chess } from '../vendor/chess.js';
import { iniciarAnunciador, anunciar, bipe, somLance } from './anunciador.js';
import { preencherListaLances } from './fala.js';
import { SPECIAL_COMMANDS } from './comandos.js';
import { Partida } from './jogo.js';
import { gerarPgn, nomeArquivoPgn, baixarPgn, criarArquivoPgn, podeCompartilharArquivo, compartilharPgn } from './pgn.js';
import {
  PRESETS_FIXOS, presetsPromovidos, registrarUsoTempoPersonalizado,
  lerPreferencias, gravarPreferencias,
  lerTemaTabuleiro, gravarTemaTabuleiro,
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
  for (const tela of TELAS) $(tela).hidden = tela !== id;
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
  lista.textContent = '';
  const todos = [
    ...PRESETS_FIXOS.map((p) => ({ ...p, promovido: false })),
    ...presetsPromovidos().map((p) => ({ ...p, promovido: true })),
  ];
  todos.forEach((preset, i) => {
    const rotulo = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'preset-tempo';
    radio.value = `${preset.minutos}+${preset.incrementoSegundos}`;
    if (i === 0) radio.checked = true;
    rotulo.appendChild(radio);
    rotulo.appendChild(document.createTextNode(
      ` ${rotuloPreset(preset.minutos, preset.incrementoSegundos)}${preset.promovido ? ' (preset seu)' : ''}`,
    ));
    lista.appendChild(rotulo);
  });
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
  jogoAtual = new Partida({ config, anunciar, bipe, somLance, aoFim: aoFimDePartida });
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

function preencherTelaResultado(fim) {
  $('resultado-texto').textContent =
    `Resultado: ${fim.resultado.replace('1/2-1/2', '½-½')} — ${NOME_RESULTADO[fim.resultado]}, por ${fim.motivo}.`;
  $('resultado-duracao').textContent =
    `Duração da partida: ${duracaoFalada((fim.encerradaEm || Date.now()) - fim.iniciadaEm)}. ${fim.sans.length} ${fim.sans.length === 1 ? 'lance' : 'lances'}.`;

  // mesmo formato fonético do histórico da tela de jogo
  const replay = new Chess();
  const lances = fim.sans.map((san) => replay.move(san));
  preencherListaLances($('historico-final'), lances);

  // Compartilhar só aparece se o navegador suporta compartilhar arquivos
  const { arquivo } = pgnDaPartida(fim);
  const suportaCompartilhar = podeCompartilharArquivo(arquivo);
  $('btn-compartilhar').hidden = !suportaCompartilhar;
  $('aviso-compartilhar').hidden = suportaCompartilhar;
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
  const nome = nomeArquivoPgn(new Date(fim.iniciadaEm));
  return { texto, nome, arquivo: criarArquivoPgn(texto, nome) };
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
  const lances = partida.sans.length;
  return `${quando} — ${brancas} contra ${pretas} — ${resultado}, por ${partida.motivo}, ${lances} ${lances === 1 ? 'lance' : 'lances'}`;
}

function renderizarHistorico() {
  const historico = lerHistorico();
  const lista = $('lista-historico');
  lista.textContent = '';
  $('historico-vazio').hidden = historico.length > 0;
  $('btn-limpar-historico').hidden = historico.length === 0;

  for (const partida of historico) {
    const item = document.createElement('li');
    const texto = document.createElement('span');
    texto.textContent = descricaoDePartida(partida);
    item.appendChild(texto);

    const acoes = document.createElement('span');
    acoes.className = 'acoes-linha';
    const btnBaixar = document.createElement('button');
    btnBaixar.type = 'button';
    btnBaixar.textContent = 'Baixar PGN';
    btnBaixar.setAttribute('aria-label', `Baixar PGN da partida de ${descricaoDePartida(partida)}`);
    btnBaixar.addEventListener('click', () => {
      const { texto: pgn, nome } = pgnDaPartida(partida);
      baixarPgn(pgn, nome);
      anunciar('PGN baixado.');
    });
    const btnApagar = document.createElement('button');
    btnApagar.type = 'button';
    btnApagar.textContent = 'Apagar';
    btnApagar.setAttribute('aria-label', `Apagar do histórico a partida de ${descricaoDePartida(partida)}`);
    btnApagar.addEventListener('click', () => {
      removerDoHistorico(partida.iniciadaEm);
      renderizarHistorico();
      anunciar('Partida apagada do histórico.');
    });
    acoes.appendChild(btnBaixar);
    acoes.appendChild(btnApagar);
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
  const lances = (salvo.sans || []).length;
  if (salvo.finalizada && salvo.resultado) {
    $('titulo-recuperacao').textContent = 'Partida encerrada sem PGN baixado';
    $('recuperacao-descricao').textContent =
      `Existe uma partida encerrada (iniciada em ${quando}, ${lances} lances, resultado ${salvo.resultado}) cujo PGN ainda não foi baixado nem compartilhado. Deseja abrir a tela de resultado para baixá-lo?`;
    $('btn-recuperar').textContent = 'Abrir tela de resultado';
  } else {
    $('titulo-recuperacao').textContent = 'Partida em andamento encontrada';
    $('recuperacao-descricao').textContent =
      `Existe uma partida em andamento (iniciada em ${quando}, ${lances} ${lances === 1 ? 'lance' : 'lances'}). Deseja continuar essa partida?`;
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
      jogoAtual.executarComando(acao);
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
    const { arquivo } = pgnDaPartida(fimAtual);
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

  $('btn-nova-partida').addEventListener('click', () => {
    // a partida encerrada já está no histórico local — nada se perde aqui
    limparPartidaAtual();
    if (jogoAtual) {
      jogoAtual.destruir();
      jogoAtual = null;
    }
    fimAtual = null;
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

function iniciarApp() {
  iniciarAnunciador($('anunciador'));
  iniciarTemas();
  renderizarPresets();
  renderizarHistorico();
  atualizarCamposPersonalizado();
  ligarEventos();
  verificarRecuperacao();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // sem service worker o app continua funcionando online
    });
  }
}

iniciarApp();
