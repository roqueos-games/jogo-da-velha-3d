# Changelog

## 0.1.0 (25/09/2026)

- O Velha 3D sai do repositório do RoqueOS e passa a falar com ele só pelo `jogo-sdk` 0.1.0.
  Motor e IA, render 3D, som, visual, chaves de armazenamento (`wins`, `diff`, `muted`),
  nomes e dados de evento (`game_start`, `game_over`) e o gancho `window.__velha` ficam como
  eram. O código que toca a GPU (renderer, pixel ratio, materiais, luzes, geometria, linha da
  vitória, perfil leve) veio sem mudança.
- `three` vira `peerDependency`: o RoqueOS fornece o dele, na mesma versão de antes.
- Texto nos dez idiomas em `i18n/`, ícones SVG próprios, e o jogo roda sozinho com
  `yarn dev`.
- A janela que perde o foco para de desenhar e de girar o cubo, como antes; o `ativo` agora
  vem do host.
- "Jogar de novo" sorteia uma semente nova. Antes, no Fácil, toda partida na mesma janela
  repetia os sorteios da IA da primeira.
- Entrar na conta com o jogo aberto traz as vitórias da conta sem reabrir o jogo.
- O perfil leve do aparelho chega pelo host e liga a classe `ros-velha--low`.
