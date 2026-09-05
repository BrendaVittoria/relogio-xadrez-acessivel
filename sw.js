// Service worker: cache do app shell na instalação, para uso 100% offline.
//
// Estratégia "snapshot atômico": o cache guarda sempre um conjunto coerente de
// arquivos, baixados de uma vez só. Ou o cache inteiro é o da versão antiga, ou
// o inteiro é o da nova — nunca uma mistura. Isso importa porque index.html e
// os módulos JS se referenciam entre si: um HTML novo com um JS antigo (ou o
// contrário) quebra o app na abertura, e o cache antigo mantinha a quebra.
//
// A troca do snapshot acontece em duas situações:
//   1. VERSAO muda (reinstalação completa do service worker);
//   2. o index.html publicado ficou diferente do que está em cache — rede de
//      segurança para o caso de a versão não ter sido incrementada.
//
// Nos dois casos a troca só vale a partir da PRÓXIMA abertura do app. Uma
// página que já está carregando nunca vê o cache mudar debaixo dela: o
// snapshot novo é baixado para um cache de espera e só é aplicado no começo
// de uma navegação, antes de qualquer arquivo ser servido. Trocar no meio de
// uma carga (como fazia antes, com skipWaiting/claim e gravação direta no
// cache em uso) deixava index.html de uma versão com módulos de outra — o app
// "bugava depois da atualização" até a pessoa recarregar de novo.
//
// AO PUBLICAR UMA MUDANÇA: incremente VERSAO_APP em js/versao.js (o mesmo
// número aparece no rodapé da página). Mudança nesse arquivo também conta
// como mudança do service worker, então o navegador reinstala.

importScripts('./js/versao.js');
const VERSAO = self.VERSAO_APP;
const PREFIXO = 'relogio-xadrez-';
const CACHE = `${PREFIXO}v${VERSAO}`;
// cache de espera: recebe o snapshot novo sem mexer no que está servindo
const CACHE_ESPERA = `${PREFIXO}espera-v${VERSAO}`;
// marca gravada por último: só um cache de espera com ela está completo
const MARCA_COMPLETO = './snapshot-completo';

const ARQUIVOS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/jogo.js',
  './js/relogio.js',
  './js/tabuleiro.js',
  './js/parser.js',
  './js/comandos.js',
  './js/fala.js',
  './js/anunciador.js',
  './js/pgn.js',
  './js/armazenamento.js',
  './js/temas.js',
  './js/versao.js',
  './vendor/chess.js',
  './sounds/move.mp3',
  './sounds/capture.mp3',
  './sounds/checkmate.mp3',
  './sounds/draw.mp3',
  './sounds/time_warning.mp3',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/pecas/wk.svg',
  './icons/pecas/wq.svg',
  './icons/pecas/wr.svg',
  './icons/pecas/wb.svg',
  './icons/pecas/wn.svg',
  './icons/pecas/wp.svg',
  './icons/pecas/bk.svg',
  './icons/pecas/bq.svg',
  './icons/pecas/br.svg',
  './icons/pecas/bb.svg',
  './icons/pecas/bn.svg',
  './icons/pecas/bp.svg',
];

// no-store ignora o cache HTTP do navegador: garante que o snapshot é o que
// está publicado agora, e não uma cópia guardada pelo próprio navegador
const daRede = (url) => fetch(new Request(url, { cache: 'no-store' }));

// Baixa todos os arquivos e só grava depois que TODOS chegaram inteiros. Se a
// conexão falhar no meio (celular em rede instável), nada é gravado e o cache
// anterior continua valendo — quebrado pela metade, nunca.
async function gravarSnapshot(cache) {
  const respostas = await Promise.all(ARQUIVOS.map(daRede));
  const falhou = respostas.find((resposta) => !resposta || !resposta.ok);
  if (falhou) throw new Error(`arquivo não baixado: ${falhou && falhou.url}`);
  await Promise.all(respostas.map((resposta, i) => cache.put(ARQUIVOS[i], resposta)));
}

// Confere se o index.html publicado mudou em relação ao do cache. É o gatilho
// reserva: se uma publicação esquecer de incrementar VERSAO, o app se conserta
// sozinho na próxima abertura com internet. O snapshot novo vai para o cache
// de espera; a página aberta continua sendo servida pelo conjunto atual.
// Roda a cada abertura: custa um GET pequeno do index.html; o download do
// conjunto inteiro só acontece quando ele mudou de verdade.
async function conferirAtualizacao() {
  try {
    const cache = await caches.open(CACHE);
    const emCache = await cache.match('./index.html');
    const publicado = await daRede('./index.html');
    if (!publicado || !publicado.ok) return;
    if (emCache && (await emCache.text()) === (await publicado.clone().text())) return;
    const espera = await caches.open(CACHE_ESPERA);
    await gravarSnapshot(espera);
    await espera.put(MARCA_COMPLETO, new Response('ok'));
  } catch {
    // sem internet ou download incompleto: segue com o snapshot atual e
    // descarta o que chegou pela metade
    await caches.delete(CACHE_ESPERA).catch(() => {});
  }
}

// Chamado no começo de cada navegação, antes de servir qualquer arquivo: se
// há um snapshot completo esperando, ele vira o conjunto em uso agora — e a
// página que vai abrir já nasce inteira na versão nova.
async function aplicarSnapshotEmEspera() {
  try {
    if (!(await caches.has(CACHE_ESPERA))) return;
    const espera = await caches.open(CACHE_ESPERA);
    if (!(await espera.match(MARCA_COMPLETO))) return; // ainda baixando
    const cache = await caches.open(CACHE);
    const chaves = await espera.keys();
    await Promise.all(chaves.map(async (requisicao) => {
      if (requisicao.url.endsWith(MARCA_COMPLETO.slice(1))) return;
      const resposta = await espera.match(requisicao);
      if (resposta) await cache.put(requisicao, resposta);
    }));
    await caches.delete(CACHE_ESPERA);
  } catch {
    // qualquer falha aqui deixa o conjunto atual valendo; tenta de novo na
    // próxima abertura
  }
}

self.addEventListener('install', (evento) => {
  // Sem skipWaiting: este service worker só assume quando todas as abas do
  // app fecharem, e a página aberta segue inteira na versão antiga.
  evento.waitUntil((async () => {
    // Cache desta VERSAO ainda não existe: é novo, ninguém é servido por ele,
    // pode gravar direto. Se já existe (sw.js publicado sem incrementar
    // VERSAO), gravar nele misturaria versões na página aberta — vai para o
    // cache de espera e entra na próxima abertura, como qualquer atualização.
    const jaEmUso = await caches.has(CACHE);
    const destino = await caches.open(jaEmUso ? CACHE_ESPERA : CACHE);
    await gravarSnapshot(destino);
    if (jaEmUso) await destino.put(MARCA_COMPLETO, new Response('ok'));
  })());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        // Só os caches DESTE app, nunca "todos menos o meu". O leitor de PGN
        // mora no mesmo endereço (brendavittoria.github.io, outra pasta) e o
        // armazenamento de caches é compartilhado por endereço, não por pasta:
        // um app enxerga e pode apagar o cache do outro. Apagar tudo que não
        // fosse meu deixava o outro app sem cópia offline a cada publicação —
        // e ele parava de abrir no primeiro momento sem internet boa.
        // o cache de espera desta VERSAO fica: pode ser o snapshot que o
        // próprio install acabou de baixar para entrar na próxima abertura
        chaves
          .filter((chave) => chave.startsWith(PREFIXO) && chave !== CACHE && chave !== CACHE_ESPERA)
          .map((chave) => caches.delete(chave)),
      )),
    // sem clients.claim(): as páginas já abertas ficam com o service worker
    // que as carregou; as próximas navegações já nascem com este
  );
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== 'GET' || !requisicao.url.startsWith(self.location.origin)) return;

  // navegações são sempre servidas pelo shell (./index.html)
  const navegacao = requisicao.mode === 'navigate';
  const chave = navegacao ? './index.html' : requisicao;

  // a troca de snapshot só acontece aqui, antes do primeiro arquivo da
  // página sair: assim ela nunca mistura versões
  const troca = navegacao ? aplicarSnapshotEmEspera() : Promise.resolve();

  evento.respondWith((async () => {
    await troca;
    // busca dentro do MEU cache: caches.match() varre todos os caches do
    // endereço, inclusive os do leitor de PGN e versões antigas minhas
    const cache = await caches.open(CACHE);
    const emCache = await cache.match(chave);
    if (emCache) return emCache;
    // fora do snapshot (arquivo novo, imagem externa ao shell): tenta a rede
    try {
      return await fetch(requisicao);
    } catch {
      return Response.error();
    }
  })());

  // a conferência roda em segundo plano, sem atrasar a resposta ao usuário —
  // mas só depois da troca, senão compara o index.html antigo com o publicado
  // e baixa de novo um snapshot que acabou de ser aplicado
  if (navegacao) evento.waitUntil(troca.then(conferirAtualizacao));
});
