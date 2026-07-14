// Controlador de uma partida: estado central (chess.js + relógio + notas),
// entrada por digitação e por tabuleiro, comandos especiais, desfazer,
// detecção de fim de jogo e persistência local para recuperação.

import { Chess } from '../vendor/chess.js';
import { RelogioXadrez } from './relogio.js';
import { TabuleiroAcessivel } from './tabuleiro.js';
import { interpretarEntrada, resolverPromocao } from './parser.js';
import { identificarComando, textoAjuda } from './comandos.js';
import {
  anunciarLanceAplicado, descreverLance, descreverLanceFalado, sufixoXeque,
  nomeCasa, nomeCor, nomePeca, preencherListaLances,
  tempoFalado, tempoVisual, PECAS, VALOR_PECAS,
} from './fala.js';
import { gravarPartidaAtual } from './armazenamento.js';

const LETRAS_PROMOCAO = {
  q: 'q', d: 'q', dama: 'q', rainha: 'q',
  r: 'r', t: 'r', torre: 'r',
  b: 'b', bispo: 'b',
  n: 'n', c: 'n', cavalo: 'n',
};

export class Partida {
  /**
   * @param {object} deps
   * @param {object} deps.config {modoEntrada, minutos, incrementoSegundos,
   *   arbitro, brancas, pretas, torneio, alarmes, somAtivado}
   * @param {function} deps.anunciar
   * @param {function} deps.bipe
   * @param {function} deps.aoFim  ({resultado, motivo, ...}) => void
   */
  constructor({ config, anunciar, bipe, aoFim }) {
    this.config = config;
    this.anunciar = anunciar;
    this.bipe = bipe;
    this.aoFim = aoFim;

    this.chess = new Chess();
    this.notas = [];
    this.fotosLances = [];
    this.ultimoLanceAnunciado = null;
    this.pendenciaAmbiguidade = null;
    this.pendenciaPromocaoTexto = null;
    this.pendenciaPromocaoTabuleiro = null;
    this.digitacaoVeioDoTabuleiro = false;
    this.correcaoNaPausa = false; // liberada por um back durante a pausa
    // revisão do histórico (vírgula/ponto no tabuleiro): quantos meios-lances
    // a posição exibida tem; null = posição atual da partida
    this.posicaoRevisao = null;
    this.chessRevisao = null;
    this.correcaoTabuleiro = null; // {indice} durante a correção pelo tabuleiro
    this.revisaoAberta = false; // controles de revisão à vista (botão Revisão)
    this.modoEntrada = config.modoEntrada;
    this.finalizada = false;
    this.jaComecou = false; // vira true no primeiro disparo real do relógio
    this.iniciadaEm = Date.now();
    this._contadorSalvar = 0;

    this.relogio = new RelogioXadrez({
      inicialMs: config.minutos * 60000,
      incrementoMs: config.incrementoSegundos * 1000,
      alarmesMinutos: config.alarmes,
      aoCairBandeira: (cor) => this._aoCairBandeira(cor),
      aoAlarme: (cor, min) => this._aoAlarme(cor, min),
      aoTique: () => this._aoTique(),
    });

    this._el = {
      tempoBrancas: document.getElementById('tempo-brancas'),
      tempoPretas: document.getElementById('tempo-pretas'),
      vezBrancas: document.getElementById('vez-brancas'),
      vezPretas: document.getElementById('vez-pretas'),
      relogioBrancas: document.getElementById('relogio-brancas'),
      relogioPretas: document.getElementById('relogio-pretas'),
      indicadorPausa: document.getElementById('indicador-pausa'),
      modoDigitacao: document.getElementById('modo-digitacao'),
      modoTabuleiro: document.getElementById('modo-tabuleiro'),
      entrada: document.getElementById('entrada'),
      historico: document.getElementById('historico'),
      btnPausar: document.getElementById('btn-pausar'),
      btnComecar: document.getElementById('btn-comecar'),
      btnVerHistorico: document.getElementById('btn-ver-historico'),
      areaHistorico: document.getElementById('area-historico'),
      areaRevisao: document.getElementById('area-revisao'),
      btnRevisao: document.getElementById('btn-revisao'),
      btnModo: document.querySelector('#painel-acoes button[data-acao="modo"]'),
      tabuleiroDigitacao: document.getElementById('tabuleiro-digitacao'),
    };

    // os tabuleiros mostram a posição em revisão, quando houver
    const obterChess = () => this.chessRevisao || this.chess;
    this.tabuleiro = new TabuleiroAcessivel(document.getElementById('tabuleiro'), {
      somenteLeitura: false,
      obterChess,
      anunciar: this.anunciar,
      aoTentarLance: (de, para, precisaPromocao) =>
        this._lanceDoTabuleiro(de, para, precisaPromocao),
      aoDigitar: (caractere) => this._digitarDoTabuleiro(caractere),
      aoNavegarHistorico: (delta) => this.navegarHistorico(delta),
      // na correção pelo tabuleiro, ele volta a aceitar lances
      emRevisao: () => this.posicaoRevisao !== null && !this.correcaoTabuleiro,
    });
    // o tabuleiro do modo digitação também aceita lances: quem preferir
    // pode mexer nele em vez de digitar
    this.tabuleiroDigitacao = new TabuleiroAcessivel(this._el.tabuleiroDigitacao, {
      somenteLeitura: false,
      obterChess,
      anunciar: this.anunciar,
      aoTentarLance: (de, para, precisaPromocao) =>
        this._lanceDoTabuleiro(de, para, precisaPromocao),
      aoDigitar: (caractere) => this._digitarDoTabuleiro(caractere),
      aoNavegarHistorico: (delta) => this.navegarHistorico(delta),
      emRevisao: () => this.posicaoRevisao !== null && !this.correcaoTabuleiro,
    });
  }

  // ---------------- ciclo de vida ----------------

  iniciar() {
    // entra na tela do jogo com os relógios parados: o árbitro se orienta
    // primeiro e dispara o relógio quando quiser (go / Retomar)
    this.relogio.iniciar();
    this.relogio.pausar();
    this.fotoInicioTurno = this.relogio.fotografia();
    this._atualizarTudo();
    this._aplicarModoEntrada(false);
    this.anunciar(
      `Partida preparada no modo ${this.modoEntrada === 'text' ? 'digitação' : 'tabuleiro'}. Ative o botão Iniciar relógio, ou o comando go, quando quiser começar.`,
    );
    this._salvar();
  }

  restaurarDe(salvo) {
    this.iniciadaEm = salvo.iniciadaEm || Date.now();
    this.notas = salvo.notas || [];
    this.modoEntrada = salvo.modoEntrada || this.config.modoEntrada;
    for (const san of salvo.sans || []) this.chess.move(san);
    this.fotosLances = salvo.fotosLances || [];
    this.relogio.tempos.w = salvo.tempos.w;
    this.relogio.tempos.b = salvo.tempos.b;
    this.relogio.ativo = salvo.ativo || this.chess.turn();
    this.relogio.recalcularAlarmes();
    this.relogio.iniciar();
    this.relogio.pausar();
    this.jaComecou = true; // a partida já estava em andamento
    this.fotoInicioTurno = salvo.fotoInicioTurno || this.relogio.fotografia();
    this._atualizarTudo();
    this._aplicarModoEntrada(false);
    this.anunciar(
      'Partida recuperada. Relógios pausados. Use o botão Retomar relógio, ou o comando go, para continuar.',
    );
    this._salvar();
  }

  destruir() {
    this.relogio.destruir();
  }

  // ---------------- entrada por digitação ----------------

  processarEntradaTexto(texto) {
    if (this.finalizada) return;
    const limpo = texto.trim();

    if (this.pendenciaPromocaoTexto) {
      this._responderPromocaoTexto(limpo);
      return;
    }
    if (this.pendenciaAmbiguidade) {
      if (this._responderAmbiguidade(limpo)) return;
      // resposta não era uma das opções: cancela a pergunta e processa normal
    }

    if (!limpo) return;

    const comando = identificarComando(limpo);
    if (comando) {
      if (comando.erro) {
        this.anunciar(comando.erro);
        this._el.entrada.select();
        return;
      }
      this._el.entrada.value = '';
      this.executarComando(comando.cmd, comando.arg);
      return;
    }

    // navegando o histórico não se joga: só comandos (corrigir, p, t...)
    if (this.posicaoRevisao !== null) {
      this.anunciar('Navegando o histórico. Ponto volta à posição atual; corrigir altera o lance navegado.');
      this._el.entrada.select();
      return;
    }

    // lances só com o relógio correndo; o texto fica selecionado na caixa
    // para reenviar com Enter depois do go
    if (!this._relogioLiberado()) {
      this._el.entrada.select();
      return;
    }

    const resultado = interpretarEntrada(limpo, this.chess);
    switch (resultado.tipo) {
      case 'lance': {
        this._el.entrada.value = '';
        const lance = this.chess.move(resultado.san);
        this._aposLance(lance);
        break;
      }
      case 'ambiguo': {
        this.pendenciaAmbiguidade = resultado.opcoes;
        const opcoes = resultado.opcoes
          .map((op, i) => `${i + 1}: ${op.descricao}`)
          .join('; ');
        this._el.entrada.value = '';
        this.anunciar(`Lance ambíguo. ${opcoes}. Digite o número da opção desejada, ou Enter vazio para cancelar.`);
        break;
      }
      case 'promocao': {
        this.pendenciaPromocaoTexto = resultado.baseSan;
        this._el.entrada.value = '';
        this.anunciar(
          `Promoção de peão em ${nomeCasa(resultado.lanceBase.to)}. Digite d para dama, t para torre, b para bispo, c para cavalo, ou Enter vazio para cancelar.`,
        );
        break;
      }
      default: {
        this.anunciar(resultado.mensagem);
        this._el.entrada.select();
      }
    }
  }

  _responderAmbiguidade(resposta) {
    const opcoes = this.pendenciaAmbiguidade;
    this.pendenciaAmbiguidade = null;
    if (!resposta) {
      this.anunciar('Cancelado. Digite o lance novamente.');
      return true;
    }
    const indice = Number(resposta);
    if (Number.isInteger(indice) && indice >= 1 && indice <= opcoes.length) {
      if (!this._relogioLiberado()) {
        this.pendenciaAmbiguidade = opcoes; // a pergunta continua valendo
        return true;
      }
      this._el.entrada.value = '';
      const lance = this.chess.move(opcoes[indice - 1].san);
      this._aposLance(lance);
      return true;
    }
    return false; // deixa a entrada ser processada como algo novo
  }

  _responderPromocaoTexto(resposta) {
    const baseSan = this.pendenciaPromocaoTexto;
    this.pendenciaPromocaoTexto = null;
    if (!resposta) {
      this.anunciar('Promoção cancelada. Digite o lance novamente.');
      return;
    }
    const letra = LETRAS_PROMOCAO[resposta.toLowerCase()];
    if (!letra) {
      this.pendenciaPromocaoTexto = baseSan;
      this.anunciar('Opção não reconhecida. Digite d para dama, t para torre, b para bispo, c para cavalo, ou Enter vazio para cancelar.');
      this._el.entrada.select();
      return;
    }
    if (!this._relogioLiberado()) {
      this.pendenciaPromocaoTexto = baseSan; // a pergunta continua valendo
      return;
    }
    const lance = resolverPromocao(baseSan, letra, this.chess);
    if (!lance) {
      this.anunciar(`Promoção a ${nomePeca(letra)} não é legal nesta posição.`);
      return;
    }
    this._el.entrada.value = '';
    const aplicado = this.chess.move(lance.san);
    this._aposLance(aplicado);
  }

  // ---------------- entrada pelo tabuleiro ----------------

  _lanceDoTabuleiro(de, para, precisaPromocao) {
    if (this.finalizada) return;
    if (precisaPromocao) {
      // vale para lance normal e para correção: a escolha da peça
      // chega por confirmarPromocaoTabuleiro
      if (!this.correcaoTabuleiro && !this._relogioLiberado()) return;
      this.pendenciaPromocaoTabuleiro = { de, para };
      const dialogo = document.getElementById('dialogo-promocao');
      dialogo.showModal();
      this.anunciar('Promoção de peão: escolha dama, torre, bispo ou cavalo.');
      return;
    }
    if (this.correcaoTabuleiro) {
      // o lance feito no tabuleiro substitui o lance errado
      this._aplicarCorrecao(this.correcaoTabuleiro.indice, (novo) =>
        novo.move({ from: de, to: para }));
      return;
    }
    if (!this._relogioLiberado()) return;
    const lance = this.chess.move({ from: de, to: para });
    this._aposLance(lance, true);
  }

  confirmarPromocaoTabuleiro(letra) {
    const pendente = this.pendenciaPromocaoTabuleiro;
    this.pendenciaPromocaoTabuleiro = null;
    if (!pendente) return;
    if (this.correcaoTabuleiro) {
      this._aplicarCorrecao(this.correcaoTabuleiro.indice, (novo) =>
        novo.move({ from: pendente.de, to: pendente.para, promotion: letra }));
      this._focarTabuleiroVisivel();
      return;
    }
    const lance = this.chess.move({ from: pendente.de, to: pendente.para, promotion: letra });
    this._aposLance(lance, true);
    this._focarTabuleiroVisivel();
  }

  cancelarPromocaoTabuleiro() {
    if (!this.pendenciaPromocaoTabuleiro) return;
    this.pendenciaPromocaoTabuleiro = null;
    this.anunciar('Promoção cancelada.');
    this._focarTabuleiroVisivel();
  }

  // O lance pode ter vindo do tabuleiro principal ou do tabuleiro do modo
  // digitação: o foco volta para o que estiver na tela.
  _focarTabuleiroVisivel() {
    if (this.modoEntrada === 'board') {
      this.tabuleiro.focarTabuleiro();
    } else if (!this._el.tabuleiroDigitacao.hidden) {
      this.tabuleiroDigitacao.focarTabuleiro();
    } else {
      this.tabuleiro.focarTabuleiro();
    }
  }

  // ---------------- comandos ----------------

  executarComando(cmd, arg) {
    if (this.finalizada) return;
    switch (cmd) {
      case 't': this._comandoTempo(); break;
      case 'p': this._comandoPosicao(); break;
      case 'r': this._comandoRepetir(); break;
      case 'm': this._comandoMaterial(); break;
      case 'back': this._comandoDesfazer(); break;
      case 'corrigir': this._comandoCorrigir(arg); break;
      case 'revisao': this.alternarRevisao(); break;
      case 'note': this.registrarNota(arg); break;
      case 'modo': this.alternarModo(); break;
      case 'hold': this._comandoPausar(); break;
      case 'go': this._comandoRetomar(); break;
      case 'draw': this._encerrar('1/2-1/2', 'acordo'); break;
      case 'resign': this._comandoAbandono(); break;
      case '?': this.anunciar(textoAjuda()); break;
    }
  }

  _comandoTempo() {
    const vez = nomeCor(this.relogio.ativo);
    this.anunciar(
      `Brancas: ${tempoFalado(this.relogio.tempos.w)}. Pretas: ${tempoFalado(this.relogio.tempos.b)}. Vez das ${vez}${this.relogio.pausado ? '. Relógios pausados' : ''}.`,
    );
  }

  _comandoPosicao() {
    // durante a revisão do histórico, descreve a posição que está na tela
    const chess = this.chessRevisao || this.chess;
    const linhas = chess.board();
    const porCor = { w: new Map(), b: new Map() };
    for (const linha of linhas) {
      for (const casa of linha) {
        if (!casa) continue;
        const mapa = porCor[casa.color];
        if (!mapa.has(casa.type)) mapa.set(casa.type, []);
        mapa.get(casa.type).push(casa.square);
      }
    }
    const ordem = ['k', 'q', 'r', 'b', 'n', 'p'];
    const plural = { k: 'reis', q: 'damas', r: 'torres', b: 'bispos', n: 'cavalos', p: 'peões' };
    const descreverCor = (cor) => {
      const partes = [];
      for (const tipo of ordem) {
        const casas = porCor[cor].get(tipo);
        if (!casas) continue;
        const nomes = casas.map(nomeCasa).join(', ');
        partes.push(`${casas.length > 1 ? plural[tipo] : PECAS[tipo].nome} em ${nomes}`);
      }
      return partes.join('; ');
    };
    const titulo = this.posicaoRevisao !== null ? 'Posição navegada' : 'Posição atual';
    this.anunciar(
      `${titulo}. Brancas: ${descreverCor('w')}. Pretas: ${descreverCor('b')}. Vez das ${nomeCor(chess.turn())}.`,
    );
  }

  _comandoRepetir() {
    if (this.ultimoLanceAnunciado) {
      this.anunciar(`Último lance: ${this.ultimoLanceAnunciado}`);
    } else {
      this.anunciar('Nenhum lance foi feito ainda.');
    }
  }

  _comandoMaterial() {
    const capturas = { w: [], b: [] };
    for (const lance of this.chess.history({ verbose: true })) {
      if (lance.captured) capturas[lance.color].push(lance.captured);
    }
    const pontos = (lista) => lista.reduce((soma, p) => soma + (VALOR_PECAS[p] || 0), 0);
    const listar = (lista) =>
      lista.length ? lista.map((p) => nomePeca(p)).join(', ') : 'nada';
    const saldoBrancas = pontos(capturas.w) - pontos(capturas.b);
    let vantagem;
    if (saldoBrancas > 0) {
      vantagem = `Vantagem material: brancas, ${saldoBrancas} ${saldoBrancas === 1 ? 'ponto' : 'pontos'}.`;
    } else if (saldoBrancas < 0) {
      vantagem = `Vantagem material: pretas, ${-saldoBrancas} ${-saldoBrancas === 1 ? 'ponto' : 'pontos'}.`;
    } else {
      vantagem = 'Material igual.';
    }
    this.anunciar(
      `Brancas capturaram: ${listar(capturas.w)}. Pretas capturaram: ${listar(capturas.b)}. ${vantagem}`,
    );
  }

  _comandoDesfazer() {
    const lance = this.chess.undo();
    if (!lance) {
      this.anunciar('Não há lance para desfazer.');
      return;
    }
    // back na pausa abre a correção: dá para redigitar os lances certos
    // ainda com o relógio parado; o bloqueio volta quando o relógio retomar
    if (this.relogio.pausado) this.correcaoNaPausa = true;
    this._sairDaRevisao(); // desfazer sempre traz o tabuleiro de volta ao presente
    const foto = this.fotosLances.pop();
    if (foto) {
      this.relogio.restaurar(foto);
      this.fotoInicioTurno = { ...foto };
    }
    // notas que apontavam para além do histórico atual passam a valer para o fim dele
    const tamanho = this.chess.history().length;
    for (const nota of this.notas) {
      if (nota.indiceLance > tamanho) nota.indiceLance = tamanho;
    }
    this.ultimoLanceAnunciado = null;
    this._atualizarTudo();
    this.anunciar(`Lance desfeito: ${descreverLance(lance)}. Vez das ${nomeCor(lance.color)} novamente.`);
    this._salvar();
  }

  // ---------------- revisão do histórico (vírgula/ponto no tabuleiro) ----

  // Botão Revisão do painel de ações e comando "revisao": mostra ou
  // esconde os controles de toque (Lance anterior, Próximo lance e Ver
  // histórico). Recolhidos, o tabuleiro fica com o máximo de espaço; no
  // teclado, vírgula/ponto continuam navegando sem precisar abrir nada.
  alternarRevisao() {
    if (this.revisaoAberta) {
      this._fecharRevisao(true);
      return;
    }
    this.revisaoAberta = true;
    this._atualizarAreaRevisao();
    this.anunciar('Revisão aberta: use Lance anterior e Próximo lance, ou vírgula e ponto no tabuleiro.');
  }

  _fecharRevisao(anunciarFechamento) {
    const estavaNavegando = this.posicaoRevisao !== null;
    this.revisaoAberta = false;
    this.correcaoTabuleiro = null; // fechar desiste da correção em curso
    this._sairDaRevisao();
    if (estavaNavegando) {
      this.tabuleiro.atualizar();
      this.tabuleiroDigitacao.atualizar();
    }
    // recolher o histórico que o Ver histórico tenha aberto (modo tabuleiro)
    this._el.btnVerHistorico.setAttribute('aria-expanded', 'false');
    this._el.btnVerHistorico.textContent = 'Ver histórico';
    if (this.modoEntrada === 'board') this._el.areaHistorico.hidden = true;
    this._atualizarAreaRevisao();
    if (anunciarFechamento) {
      this.anunciar(estavaNavegando ? 'Revisão fechada. Posição atual.' : 'Revisão fechada.');
    }
  }

  _atualizarAreaRevisao() {
    this._el.areaRevisao.hidden = !this.revisaoAberta;
    // na digitação o histórico já está sempre à vista; o botão seria redundante
    this._el.btnVerHistorico.hidden = this.modoEntrada === 'text';
    this._el.btnRevisao.textContent = this.revisaoAberta ? 'Fechar revisão' : 'Revisão';
  }

  // Pública: usada pelas teclas vírgula/ponto e pelos botões de toque.
  navegarHistorico(delta) {
    this.correcaoTabuleiro = null; // navegar desiste da correção em curso
    const total = this.chess.history().length;
    if (total === 0) {
      this.anunciar('Nenhum lance na partida ainda.');
      return;
    }
    const atual = this.posicaoRevisao ?? total;
    const alvo = Math.max(0, Math.min(total, atual + delta));
    if (alvo === atual) {
      this.anunciar(delta < 0 ? 'Início da partida.' : 'Posição atual.');
      return;
    }
    this._irParaPosicao(alvo);
  }

  _irParaPosicao(alvo) {
    const verboso = this.chess.history({ verbose: true });
    if (alvo >= verboso.length) {
      // de volta ao presente
      this.posicaoRevisao = null;
      this.chessRevisao = null;
      this.tabuleiro.atualizar();
      this.tabuleiroDigitacao.atualizar();
      this.anunciar('Posição atual.');
      return;
    }
    this.posicaoRevisao = alvo;
    const c = new Chess();
    for (let i = 0; i < alvo; i++) {
      c.move({ from: verboso[i].from, to: verboso[i].to, promotion: verboso[i].promotion });
    }
    this.chessRevisao = c;
    this.tabuleiro.atualizar();
    this.tabuleiroDigitacao.atualizar();
    if (alvo === 0) {
      this.anunciar('Posição inicial.');
    } else {
      const lance = verboso[alvo - 1];
      const numero = Math.floor((alvo - 1) / 2) + 1;
      this.anunciar(
        `${numero} ${nomeCor(lance.color)}: ${descreverLanceFalado(lance)}${sufixoXeque(lance.san)}`,
      );
    }
  }

  _sairDaRevisao() {
    this.posicaoRevisao = null;
    this.chessRevisao = null;
  }

  // Índice do meio-lance visado por uma correção sem número: o lance
  // navegado com vírgula/ponto, ou o último se não houver revisão aberta.
  _indiceParaCorrigir() {
    return this.posicaoRevisao !== null
      ? this.posicaoRevisao - 1
      : this.chess.history().length - 1;
  }

  // Corrige um lance passado mantendo o resto da partida (comando de texto).
  _comandoCorrigir({ numero, cor, texto }) {
    const historico = this.chess.history({ verbose: true });
    let indice;
    if (numero) {
      indice = (numero - 1) * 2 + (cor === 'pretas' ? 1 : 0);
      if (numero < 1 || indice >= historico.length) {
        this.anunciar(`Não existe lance ${numero} das ${cor} para corrigir.`);
        return;
      }
    } else {
      indice = this._indiceParaCorrigir();
      if (indice < 0) {
        this.anunciar('Nenhum lance para corrigir. Navegue com vírgula e ponto até o lance errado.');
        return;
      }
    }

    this._aplicarCorrecao(indice, (novo) => {
      const resultado = interpretarEntrada(texto, novo);
      if (resultado.tipo === 'ambiguo') {
        const opcoes = resultado.opcoes.map((op) => op.descricao).join('; ');
        this.anunciar(`Lance ambíguo nessa posição: ${opcoes}. Repita o comando indicando a origem.`);
        return null;
      }
      if (resultado.tipo === 'promocao') {
        this.anunciar('Inclua a peça da promoção no lance corrigido. Exemplo: e8q para dama.');
        return null;
      }
      if (resultado.tipo !== 'lance') {
        this.anunciar(`${texto} não é legal nessa posição.`);
        return null;
      }
      return novo.move(resultado.san);
    });
  }

  // Núcleo da correção: reconstrói a linha até o lance visado, aplica o
  // lance produzido no lugar dele e reaplica os lances seguintes (por casa
  // de origem e destino, então a notação deles se ajusta sozinha). O relógio
  // não muda — é correção de registro, não de tempo. Uma nota fica no PGN.
  // Em qualquer erro, nada é alterado.
  _aplicarCorrecao(indice, produzirLance) {
    const historico = this.chess.history({ verbose: true });
    const numero = Math.floor(indice / 2) + 1;
    const cor = indice % 2 === 0 ? 'brancas' : 'pretas';

    const novo = new Chess();
    for (let i = 0; i < indice; i++) {
      novo.move({ from: historico[i].from, to: historico[i].to, promotion: historico[i].promotion });
    }

    const corrigido = produzirLance(novo);
    if (!corrigido) return; // mensagem de erro já anunciada por quem produziu

    const antigo = historico[indice];
    if (antigo.san === corrigido.san) {
      this.anunciar(`O lance ${numero} das ${cor} já é ${descreverLanceFalado(corrigido)}.`);
      return;
    }

    // reaplicar o resto da partida sobre a linha corrigida
    for (let i = indice + 1; i < historico.length; i++) {
      try {
        novo.move({ from: historico[i].from, to: historico[i].to, promotion: historico[i].promotion });
      } catch {
        const numeroQuebrado = Math.floor(i / 2) + 1;
        const corQuebrada = i % 2 === 0 ? 'brancas' : 'pretas';
        this.anunciar(
          `Correção impossível: com ${descreverLanceFalado(corrigido)}, o lance ${numeroQuebrado} das ${corQuebrada} (${descreverLanceFalado(historico[i])}) deixa de ser legal. Nada foi alterado.`,
        );
        return;
      }
    }

    this.chess = novo;
    this.correcaoTabuleiro = null;
    this._sairDaRevisao(); // o tabuleiro volta a mostrar a partida corrigida
    this.notas.push({
      indiceLance: indice + 1,
      texto: `Correção do árbitro: lance ${numero} das ${cor} alterado de ${descreverLanceFalado(antigo)} para ${descreverLanceFalado(corrigido)}.`,
      registradaEm: new Date().toISOString(),
    });
    const ultimo = novo.history({ verbose: true }).at(-1);
    this.ultimoLanceAnunciado =
      `${nomeCor(ultimo.color)}: ${descreverLanceFalado(ultimo)}${sufixoXeque(ultimo.san)}`;
    this._atualizarTudo();
    this.anunciar(`Lance ${numero} das ${cor} corrigido: ${descreverLanceFalado(corrigido)}. Nota registrada.`);
    this._salvar();
  }

  // Botão Corrigir do painel de ações. No modo tabuleiro, entra em correção
  // pelo próprio tabuleiro: mostra a posição anterior ao lance errado e o
  // próximo lance feito nas casas o substitui — sem depender do teclado.
  // No modo digitação, pré-preenche o comando na caixa.
  prepararCorrecao() {
    if (this.finalizada) return;
    if (this.correcaoTabuleiro) {
      // segundo toque no botão cancela a correção
      this.correcaoTabuleiro = null;
      this._sairDaRevisao();
      this.tabuleiro.atualizar();
      this.tabuleiroDigitacao.atualizar();
      this.anunciar('Correção cancelada.');
      return;
    }
    const historico = this.chess.history({ verbose: true });
    if (historico.length === 0) {
      this.anunciar('Nenhum lance para corrigir.');
      return;
    }
    if (this.modoEntrada !== 'board') {
      const entrada = this._el.entrada;
      entrada.value = 'corrigir ';
      entrada.focus();
      entrada.setSelectionRange(entrada.value.length, entrada.value.length);
      this.anunciar('Complete com o lance certo e Enter. Sem número, vale o lance navegado ou o último.');
      return;
    }
    const indice = this._indiceParaCorrigir();
    if (indice < 0) {
      this.anunciar('Posição inicial. Avance até o lance errado antes de corrigir.');
      return;
    }
    const antigo = historico[indice];
    const numero = Math.floor(indice / 2) + 1;
    const cor = indice % 2 === 0 ? 'brancas' : 'pretas';
    this.correcaoTabuleiro = { indice };
    this._irParaPosicao(indice); // posição ANTES do lance errado
    this.tabuleiro.focarCasa(antigo.from);
    this.anunciar(
      `Correção do lance ${numero} das ${cor}, ${descreverLanceFalado(antigo)}: faça o lance certo no tabuleiro, ou toque em Corrigir de novo para cancelar.`,
    );
  }

  registrarNota(texto) {
    if (!texto || !texto.trim()) {
      this.anunciar('Nota vazia não registrada.');
      return;
    }
    this.notas.push({
      indiceLance: this.chess.history().length,
      texto: texto.trim(),
      registradaEm: new Date().toISOString(),
    });
    this.anunciar('Nota registrada.');
    this._salvar();
  }

  _comandoPausar() {
    if (this.relogio.pausado) {
      this.anunciar('Os relógios já estão pausados.');
      return;
    }
    this.relogio.pausar();
    this._atualizarRelogios();
    this.anunciar('Tempo pausado.');
    this._salvar();
  }

  _comandoRetomar() {
    if (!this.relogio.pausado) {
      this.anunciar('Os relógios já estão correndo.');
      return;
    }
    const primeiraVez = !this.jaComecou;
    this.jaComecou = true;
    this.correcaoNaPausa = false;
    this.relogio.retomar();
    this._atualizarRelogios();
    // mensagens curtas, a pedido da Brenda: confirmar sem tomar tempo de fala
    this.anunciar(primeiraVez ? 'Partida iniciada.' : 'Tempo retomado.');
    this._salvar();
  }

  _comandoAbandono() {
    const desistente = this.chess.turn();
    const resultado = desistente === 'w' ? '0-1' : '1-0';
    this.anunciar(`Abandono das ${nomeCor(desistente)}.`);
    this._encerrar(resultado, 'abandono');
  }

  alternarRelogio() {
    // barra de espaço fora da caixa de texto: troca o lado que corre
    if (this.finalizada || this.relogio.pausado) return;
    this.relogio.alternar();
    this.fotoInicioTurno = this.relogio.fotografia();
    this._atualizarRelogios();
    this.anunciar(`Relógio alternado manualmente. Correndo para as ${nomeCor(this.relogio.ativo)}.`);
  }

  // Letra digitada com o foco numa casa do tabuleiro: continua a digitação
  // na caixa de lances, já com o caractere que a pessoa acabou de teclar.
  // Quando esse lance se completar, o foco volta ao tabuleiro, na casa de
  // destino (ver _aposLance).
  _digitarDoTabuleiro(caractere) {
    this.digitacaoVeioDoTabuleiro = true;
    const entrada = this._el.entrada;
    entrada.value += caractere;
    entrada.focus();
    const fim = entrada.value.length;
    entrada.setSelectionRange(fim, fim);
  }

  focarEntradaAtiva() {
    if (this.modoEntrada === 'text') {
      this._el.entrada.focus();
    } else {
      this.tabuleiro.focarTabuleiro();
    }
  }

  alternarModo() {
    this.correcaoTabuleiro = null; // trocar de modo desiste da correção em curso
    this.modoEntrada = this.modoEntrada === 'text' ? 'board' : 'text';
    this._aplicarModoEntrada(true);
    this._salvar();
  }

  _aplicarModoEntrada(anunciarTroca) {
    const digitacao = this.modoEntrada === 'text';
    this._el.modoDigitacao.hidden = !digitacao;
    this._el.modoTabuleiro.hidden = digitacao;
    // trocar de modo recolhe os controles de revisão; cada modo reabre
    // pelo botão Revisão quando quiser
    this._fecharRevisao(false);
    // histórico: sempre à vista na digitação; no tabuleiro fica recolhido
    // atrás do Ver histórico da revisão, para não poluir a tela
    this._el.areaHistorico.hidden = !digitacao;
    // o botão do painel leva sempre ao OUTRO modo
    this._el.btnModo.textContent = digitacao ? 'Tabuleiro' : 'Digitação';
    if (anunciarTroca) {
      this.anunciar(digitacao ? 'Modo digitação ativado.' : 'Modo tabuleiro ativado.');
    }
    if (digitacao) {
      this._el.entrada.focus();
    } else {
      this.tabuleiro.atualizar();
      this.tabuleiro.focarTabuleiro();
    }
  }

  // ---------------- fim de jogo ----------------

  encerrarManual(resultado, motivo) {
    this._encerrar(resultado, motivo);
  }

  _aoCairBandeira(cor) {
    const resultado = cor === 'w' ? '0-1' : '1-0';
    this.anunciar(`Tempo esgotado das ${nomeCor(cor)}.`);
    if (this.config.somAtivado) this.bipe(3, 660);
    this._encerrar(resultado, 'tempo');
  }

  _aoAlarme(cor, minutos) {
    this.anunciar(`Atenção: ${nomeCor(cor)} com ${minutos} ${minutos === 1 ? 'minuto restante' : 'minutos restantes'}.`);
    if (this.config.somAtivado) this.bipe(2);
  }

  _verificarFimAutomatico(lance) {
    const c = this.chess;
    if (c.isCheckmate()) {
      this._encerrar(lance.color === 'w' ? '1-0' : '0-1', 'xeque-mate');
      return true;
    }
    if (c.isStalemate()) { this._encerrar('1/2-1/2', 'afogamento'); return true; }
    if (c.isInsufficientMaterial()) { this._encerrar('1/2-1/2', 'material insuficiente'); return true; }
    if (c.isThreefoldRepetition()) { this._encerrar('1/2-1/2', 'repetição tripla'); return true; }
    if (c.isDrawByFiftyMoves()) { this._encerrar('1/2-1/2', 'regra dos 50 lances'); return true; }
    return false;
  }

  _encerrar(resultado, motivo) {
    if (this.finalizada) return;
    this.finalizada = true;
    this.relogio.parar();
    this.resultado = resultado;
    this.motivo = motivo;
    this.encerradaEm = Date.now();
    this._salvar();
    this.aoFim({
      resultado,
      motivo,
      sans: this.chess.history(),
      notas: this.notas,
      config: this.config,
      iniciadaEm: this.iniciadaEm,
      encerradaEm: this.encerradaEm,
    });
  }

  // ---------------- interno ----------------

  // `feitoNoTabuleiro`: lance clicado/confirmado direto no tabuleiro — quem
  // fez já sabe o que moveu, então o anúncio completo seria redundante.
  _aposLance(lance, feitoNoTabuleiro = false) {
    this.fotosLances.push({ ...this.fotoInicioTurno });
    this.relogio.pressionar();
    this.fotoInicioTurno = this.relogio.fotografia();

    // anúncio sem a cor ("eva 4."): quem registrou sabe de quem foi;
    // o comando r mantém a cor, que ajuda fora de contexto
    const anuncio = anunciarLanceAplicado(lance, this.chess);
    this.ultimoLanceAnunciado = `${nomeCor(lance.color)}: ${anuncio}`;
    this._atualizarTudo();

    const veioDaDigitacaoDoTabuleiro = this.digitacaoVeioDoTabuleiro;
    this.digitacaoVeioDoTabuleiro = false;
    const fimDeJogo = this._verificarFimAutomatico(lance);
    if (!fimDeJogo) this._salvar();

    // Digitação que começou numa casa do tabuleiro: devolver o foco a ele,
    // na casa de destino. O leitor de tela já lê o rótulo da casa focada
    // ("felix 3: cavalo branco"), então anunciar o lance por cima seria
    // repetitivo — só o xeque, que a casa não conta, é anunciado. O mesmo
    // vale para lances feitos diretamente no tabuleiro. No fim de jogo o
    // anúncio completo permanece (a tela de resultado toma o foco).
    const focouTabuleiro = veioDaDigitacaoDoTabuleiro && !fimDeJogo && this._focarCasaDoLance(lance.to);
    if ((focouTabuleiro || feitoNoTabuleiro) && !fimDeJogo) {
      if (this.chess.inCheck()) this.anunciar('Xeque.');
    } else {
      this.anunciar(anuncio);
    }
  }

  // Lances exigem o relógio correndo; comandos continuam livres na pausa.
  // Exceção: depois de um back na pausa, a correção pode ser digitada
  // com o relógio ainda parado.
  _relogioLiberado() {
    if (!this.relogio.pausado || this.correcaoNaPausa) return true;
    this.anunciar(this.jaComecou
      ? 'Tempo pausado. Use go ou o botão Retomar antes do lance.'
      : 'Partida não iniciada. Use go ou o botão Iniciar relógio antes do lance.');
    return false;
  }

  // Devolve true se conseguiu levar o foco a um tabuleiro visível.
  _focarCasaDoLance(casa) {
    if (this.modoEntrada === 'board') {
      this.tabuleiro.focarCasa(casa);
      return true;
    }
    if (!this._el.tabuleiroDigitacao.hidden) {
      this.tabuleiroDigitacao.focarCasa(casa);
      return true;
    }
    return false;
  }

  _aoTique() {
    this._atualizarRelogios();
    // salvamento periódico (a cada ~5 s) para o tempo não se perder num travamento
    this._contadorSalvar++;
    if (this._contadorSalvar >= 25 && !this.finalizada) {
      this._contadorSalvar = 0;
      this._salvar();
    }
  }

  _atualizarRelogios() {
    this._el.tempoBrancas.textContent = tempoVisual(this.relogio.tempos.w);
    this._el.tempoPretas.textContent = tempoVisual(this.relogio.tempos.b);
    const vezBrancas = this.relogio.ativo === 'w' && !this.finalizada;
    this._el.vezBrancas.hidden = !vezBrancas;
    this._el.vezPretas.hidden = vezBrancas;
    this._el.relogioBrancas.classList.toggle('ativa', vezBrancas);
    this._el.relogioPretas.classList.toggle('ativa', !vezBrancas);
    this._el.indicadorPausa.hidden = !this.relogio.pausado || this.finalizada;
    if (this._el.btnPausar) {
      this._el.btnPausar.textContent = this.relogio.pausado ? 'Retomar' : 'Pausar';
    }
    // botão visível de iniciar/retomar: aparece pausado, some com o relógio correndo
    this._el.btnComecar.hidden = !this.relogio.pausado || this.finalizada;
    this._el.btnComecar.textContent = this.jaComecou ? 'Retomar relógio' : 'Iniciar relógio';
  }

  _atualizarHistorico() {
    preencherListaLances(this._el.historico, this.chess.history({ verbose: true }));
  }

  _atualizarTudo() {
    this._atualizarRelogios();
    this._atualizarHistorico();
    this.tabuleiro.atualizar();
    this.tabuleiroDigitacao.atualizar();
  }

  _salvar() {
    gravarPartidaAtual({
      config: this.config,
      sans: this.chess.history(),
      notas: this.notas,
      iniciadaEm: this.iniciadaEm,
      tempos: { w: this.relogio.tempos.w, b: this.relogio.tempos.b },
      ativo: this.relogio.ativo,
      pausado: this.relogio.pausado,
      fotosLances: this.fotosLances,
      fotoInicioTurno: this.fotoInicioTurno,
      modoEntrada: this.modoEntrada,
      finalizada: this.finalizada,
      resultado: this.resultado || null,
      motivo: this.motivo || null,
      encerradaEm: this.encerradaEm || null,
    });
  }
}
