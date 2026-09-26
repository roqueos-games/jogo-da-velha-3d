# Velha 3D

Jogo da organização roqueos-games, montado pelo RoqueOS através do `jogo-sdk`. Leia o
README antes de mudar qualquer coisa.

- Gate: `yarn verificar` (o mesmo do CI e do pre-push).
- O jogo só importa `vue`, `three` (peer: o RoqueOS fornece o dele), `@roqueos-games/jogo-sdk`
  e arquivo deste repo. O RoqueOS confere isso e reprova o pin se aparecer outra coisa.
- Não troque a versão do `three`: a de `devDependencies` é a que o RoqueOS instala.
- Código que toca a GPU (renderer, pixel ratio, materiais, luzes, geometria, perfil leve) só
  muda com evidência num iPhone de verdade. O teste usa um dublê do three e não vê a GPU.
- JSON do jogo entra com `?raw` e `JSON.parse`: o build do RoqueOS quebra com import de JSON
  direto.
- Chaves de armazenamento e nomes de evento não mudam.
- Toda correção vem com teste que reprova sem ela.
- Português do Brasil no código e nos commits.
