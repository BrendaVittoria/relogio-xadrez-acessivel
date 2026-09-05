// Versão publicada do app: um número só, lido pelo service worker (nome do
// cache) e pela página (rodapé "Versão N", para quem pede ajuda dizer qual
// tem instalada). Script clássico, não módulo, porque o service worker o
// carrega com importScripts.
//
// AO PUBLICAR UMA MUDANÇA: incremente aqui.
self.VERSAO_APP = 12;
