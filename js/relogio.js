// Relógio de xadrez com incremento Fischer, pausa (hold/go),
// alarmes por marcas de minutos e snapshots para desfazer lances.

export class RelogioXadrez {
  /**
   * @param {object} opcoes
   * @param {number} opcoes.inicialMs   tempo inicial de cada lado
   * @param {number} opcoes.incrementoMs incremento Fischer por lance
   * @param {number[]} opcoes.alarmesMinutos marcas de aviso (minutos restantes)
   * @param {function} opcoes.aoCairBandeira (cor) => void
   * @param {function} opcoes.aoAlarme (cor, minutos) => void
   * @param {function} opcoes.aoTique () => void  chamado a cada atualização
   */
  constructor({ inicialMs, incrementoMs, alarmesMinutos = [], aoCairBandeira, aoAlarme, aoTique }) {
    this.incrementoMs = incrementoMs;
    this.alarmesMinutos = [...alarmesMinutos].sort((a, b) => b - a);
    this.aoCairBandeira = aoCairBandeira;
    this.aoAlarme = aoAlarme;
    this.aoTique = aoTique;

    this.tempos = { w: inicialMs, b: inicialMs };
    this.ativo = 'w';
    this.pausado = true;
    this.encerrado = false;
    this._ultimoTs = null;
    this._intervalo = null;
    this._disparados = { w: new Set(), b: new Set() };
    this.recalcularAlarmes();
  }

  iniciar() {
    this.pausado = false;
    this._ultimoTs = performance.now();
    this._intervalo = setInterval(() => this._tique(), 200);
  }

  _consumir() {
    if (this.pausado || this.encerrado || this._ultimoTs === null) return;
    const agora = performance.now();
    const decorrido = agora - this._ultimoTs;
    this._ultimoTs = agora;
    this.tempos[this.ativo] = Math.max(0, this.tempos[this.ativo] - decorrido);
  }

  _tique() {
    if (this.pausado || this.encerrado) return;
    this._consumir();
    const cor = this.ativo;
    // alarmes só para o lado que está correndo
    for (const min of this.alarmesMinutos) {
      if (!this._disparados[cor].has(min) && this.tempos[cor] <= min * 60000) {
        this._disparados[cor].add(min);
        if (this.tempos[cor] > 0 && this.aoAlarme) this.aoAlarme(cor, min);
      }
    }
    if (this.tempos[cor] <= 0) {
      this.tempos[cor] = 0;
      this.encerrado = true;
      clearInterval(this._intervalo);
      if (this.aoCairBandeira) this.aoCairBandeira(cor);
    }
    if (this.aoTique) this.aoTique();
  }

  // Lance concluído pelo lado ativo: aplica incremento e passa a vez.
  pressionar() {
    this._consumir();
    if (this.encerrado) return;
    this.tempos[this.ativo] += this.incrementoMs;
    this.ativo = this.ativo === 'w' ? 'b' : 'w';
    if (this.aoTique) this.aoTique();
  }

  // Alternância manual (barra de espaço), sem incremento.
  alternar() {
    this._consumir();
    if (this.encerrado) return;
    this.ativo = this.ativo === 'w' ? 'b' : 'w';
    if (this.aoTique) this.aoTique();
  }

  pausar() {
    this._consumir();
    this.pausado = true;
    if (this.aoTique) this.aoTique();
  }

  retomar() {
    if (this.encerrado) return;
    this.pausado = false;
    this._ultimoTs = performance.now();
    if (this.aoTique) this.aoTique();
  }

  fotografia() {
    this._consumir();
    return { w: this.tempos.w, b: this.tempos.b, ativo: this.ativo };
  }

  restaurar(foto) {
    this.tempos.w = foto.w;
    this.tempos.b = foto.b;
    this.ativo = foto.ativo;
    this.encerrado = false;
    this._ultimoTs = performance.now();
    this.recalcularAlarmes();
    if (this.aoTique) this.aoTique();
  }

  // Marca como já disparadas as marcas iguais ou acima do tempo atual, sem
  // desmarcar nada: cada alarme fala no máximo uma vez por lado. Sem isso,
  // o incremento Fischer empurraria o tempo de volta para cima da marca e o
  // aviso repetiria (ex.: "30 minutos restantes" logo no início de uma
  // partida de 30 minutos com incremento).
  _recalcularAlarmesLado(cor) {
    for (const min of this.alarmesMinutos) {
      if (this.tempos[cor] <= min * 60000) this._disparados[cor].add(min);
    }
  }

  recalcularAlarmes() {
    this._recalcularAlarmesLado('w');
    this._recalcularAlarmesLado('b');
  }

  parar() {
    this._consumir();
    this.encerrado = true;
    if (this._intervalo) clearInterval(this._intervalo);
  }

  destruir() {
    if (this._intervalo) clearInterval(this._intervalo);
  }
}
