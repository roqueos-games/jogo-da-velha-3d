// O Velha 3D inteiro, montado pelo contrato do jogo-sdk com o host falso.
//
// Nenhum mock de store, de analytics ou de i18n do RoqueOS: se o jogo ainda
// alcançasse algo do RoqueOS, este arquivo não rodaria fora dele. Os sete casos
// do teste que rodava no front antes da extração, em 25/09/2026, estão aqui
// (marcados com "Do front:"), com os do contrato em volta. O único mock é o do
// three, porque o jsdom não tem WebGL (ver threeStub.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import * as THREE from 'three'
import { VERSAO_DO_CONTRATO } from '@roqueos-games/jogo-sdk'
import { criarHostFalso } from '@roqueos-games/jogo-sdk/host-falso'
import jogo from '../src/index.js'
import { traduzir } from '../src/textos.js'
import ptBR from '../i18n/pt-BR.json'
import enUS from '../i18n/en-US.json'
import tela from '../src/JogoVelha3D.vue?raw'

vi.mock('three', async () => (await import('./threeStub.js')).criarThreeFalso())

let el = null
let host = null
let montagem = null
// O laço do jogo roda no requestAnimationFrame. Aqui o quadro só anda quando o
// teste manda, e o giro do cubo fica reproduzível. É uma fila, e não "o último
// callback", porque as <transition> do Vue também pedem quadro.
let fila = []
let relogio = 0
const rodar = (n = 1, passo = 50) => {
  for (let i = 0; i < n; i++) {
    relogio += passo
    for (const fn of fila.splice(0)) fn(relogio)
  }
}

const palco = () => {
  el = document.createElement('div')
  document.body.appendChild(el)
  return el
}
const montou = () =>
  vi.waitFor(() => {
    if (!el.querySelector('.ros-velha')) throw new Error('o Velha 3D ainda não montou')
  })
const montarCom = async (h, { ativo = true } = {}) => {
  host = h
  montagem = jogo.mount(palco(), host, { windowId: 'w1', ativo })
  // O app só monta com o texto do idioma carregado.
  await montou()
  await nextTick()
}
const montar = ({ ativo = true, ...opcoesDoHost } = {}) =>
  montarCom(criarHostFalso({ jogoId: 'velha3d', ...opcoesDoHost }), { ativo })
const $ = (sel) => el.querySelector(sel)
const eventos = (nome) =>
  host.chamadas.filter((c) => c.capacidade === 'metricas' && c.args[0] === nome)
const tecla = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))
const ponteiro = (tipo, x, y) =>
  $('.ros-velha__canvas canvas').dispatchEvent(
    new MouseEvent(tipo, { bubbles: true, clientX: x, clientY: y }),
  )
const renderizador = () => $('.ros-velha__canvas canvas').__renderizador
// O grupo do cubo é o filho da cena com as 64 casas. Só existe depois do
// primeiro quadro, que é quando o renderizador falso vê a cena.
const cubo = () => renderizador().cena.children.find((c) => c.children.length >= 64)
const pecasDaIA = () => window.__velha.state.board.filter((c) => c === 2).length
// Três marcas do jogador na linha 0-1-2-3, e a quarta pela jogada de verdade.
const vencer = (dificuldade = 'hard') => {
  window.__velha.start(dificuldade)
  const st = window.__velha.state
  st.board[0] = 1
  st.board[1] = 1
  st.board[2] = 1
  st.turn = 1
  window.__velha.place(3)
  return st
}

describe('Velha 3D pelo jogo-sdk', () => {
  beforeEach(() => {
    window.__ROS_E2E__ = {} // instala o gancho __velha
    fila = []
    relogio = 0
    THREE.Raycaster.mira = null
    vi.stubGlobal('requestAnimationFrame', (fn) => fila.push(fn))
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => {
    montagem?.desmontar()
    el?.remove()
    montagem = null
    el = null
    host = null
    THREE.Raycaster.mira = null
    delete window.__ROS_E2E__
    delete window.__velha
    delete window.devicePixelRatio
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('é um jogo do SDK, com o id que o catálogo e o recorde usam', () => {
    expect(jogo.id).toBe('velha3d')
    expect(jogo.versaoDoContrato).toBe(VERSAO_DO_CONTRATO)
    expect(jogo.capacidades).toEqual([])
  })

  // Do front: 'renders the difficulty menu with a ready engine'.
  it('abre no menu de dificuldade, com o motor pronto e o texto do idioma do host', async () => {
    await montar()
    expect($('.ros-velha__logo').textContent).toBe(ptBR.title)
    expect($('.ros-velha__tagline').textContent).toBe(ptBR.tagline)
    const botoes = [...el.querySelectorAll('.ros-velha__diff')]
    expect(botoes.map((b) => b.textContent.trim())).toEqual([
      ptBR.diff.easy,
      ptBR.diff.medium,
      ptBR.diff.hard,
    ])
    expect($('.ros-velha__hud')).toBeNull()
    expect($('.ros-velha__start-wins')).toBeNull()
    expect(window.__velha.state.status).toBe('idle')
    expect(window.__velha.state.board.every((c) => c === 0)).toBe(true)
  })

  it('fala o idioma do host, e troca quando o host troca', async () => {
    await montar({ idioma: 'en-US' })
    expect($('.ros-velha__logo').textContent).toBe(enUS.title)
    expect($('.ros-velha__diff--hard').textContent.trim()).toBe(enUS.diff.hard)
    host.disparar('idioma', 'pt-BR')
    await vi.waitFor(() => expect($('.ros-velha__logo').textContent).toBe(ptBR.title))
    expect($('.ros-velha__diff--hard').textContent.trim()).toBe(ptBR.diff.hard)
  })

  it('em árabe o jogo se desenha da direita para a esquerda', async () => {
    await montar({ idioma: 'ar-AR' })
    expect($('.ros-velha').getAttribute('dir')).toBe('rtl')
  })

  // Do front: 'starting a game fires analytics and gives the human the first move'.
  it('escolher a dificuldade começa: a vez é do jogador, e game_start sai com o nome e os dados de antes', async () => {
    await montar()
    $('.ros-velha__diff--medium').click()
    await nextTick()
    expect(window.__velha.state.status).toBe('playing')
    expect(window.__velha.state.turn).toBe(1)
    expect(window.__velha.state.difficulty).toBe('medium')
    expect(eventos('game_start').map((c) => c.args)).toEqual([
      ['game_start', { difficulty: 'medium' }],
    ])
    expect($('.ros-velha__hud')).not.toBeNull()
    expect($('.ros-velha__turn').textContent).toBe(ptBR.yourTurn)
    expect(host.storage.getItem('roqueos:velha3d:diff')).toBe('medium')
  })

  it('o clique que começa destrava o áudio no mesmo gesto', async () => {
    await montar()
    expect(host.contar('audio', 'destravar')).toBe(0)
    $('.ros-velha__diff--easy').click()
    expect(host.contar('audio', 'destravar')).toBe(1)
  })

  // Do front: 'a human move marks the cell and hands the turn to the AI'.
  it('a jogada do jogador marca a casa e passa a vez para a IA', async () => {
    await montar()
    window.__velha.start('medium')
    window.__velha.place(0)
    expect(window.__velha.state.board[0]).toBe(1)
    expect(window.__velha.state.turn).toBe(2)
    await nextTick()
    expect($('.ros-velha__turn').textContent).toBe(ptBR.aiThinking)
  })

  // Do front: 'the AI replies after its thinking delay'.
  it('a IA responde depois do tempo de pensar', async () => {
    await montar()
    vi.useFakeTimers()
    window.__velha.start('medium')
    window.__velha.place(0)
    vi.advanceTimersByTime(400)
    expect(pecasDaIA()).toBe(0)
    vi.advanceTimersByTime(200)
    expect(pecasDaIA()).toBe(1)
    expect(window.__velha.state.turn).toBe(1)
  })

  it('no perfil leve a IA pensa menos, como antes', async () => {
    await montar({ modoLeve: true })
    vi.useFakeTimers()
    window.__velha.start('medium')
    window.__velha.place(0)
    vi.advanceTimersByTime(260)
    expect(pecasDaIA()).toBe(1)
  })

  it('clicar sem arrastar marca a casa que está sob o ponteiro', async () => {
    await montar()
    window.__velha.start('medium')
    THREE.Raycaster.mira = 21
    ponteiro('pointerdown', 100, 100)
    ponteiro('pointerup', 103, 102)
    expect(window.__velha.state.board[21]).toBe(1)
    expect(window.__velha.state.turn).toBe(2)
  })

  it('arrastar gira o cubo e não marca casa nenhuma', async () => {
    await montar()
    window.__velha.start('medium')
    rodar(1)
    const c = cubo()
    const x0 = c.rotation.x
    const y0 = c.rotation.y
    THREE.Raycaster.mira = 21
    ponteiro('pointerdown', 100, 100)
    ponteiro('pointermove', 160, 120)
    ponteiro('pointerup', 160, 120)
    expect(c.rotation.y).toBeCloseTo(y0 + 60 * 0.008)
    expect(c.rotation.x).toBeCloseTo(x0 + 20 * 0.008)
    expect(window.__velha.state.board.every((v) => v === 0)).toBe(true)
  })

  // Do front: 'completing a line wins, counts the victory and fires game_over'.
  it('fechar uma linha vence: a vitória vai para a chave e para a conta, e game_over sai com o nome de antes', async () => {
    await montar()
    const st = vencer('hard')
    await nextTick()
    expect(st.status).toBe('won')
    expect(st.winner).toBe(1)
    const titulo = $('.ros-velha__over-title')
    expect(titulo.classList.contains('is-win')).toBe(true)
    expect(titulo.textContent.trim()).toBe(ptBR.youWin)
    expect($('.ros-velha__over-sub').textContent).toContain('1')
    expect(host.storage.getItem('roqueos:velha3d:wins')).toBe('1')
    expect(eventos('game_over').map((c) => c.args)).toEqual([
      ['game_over', { result: 'win', difficulty: 'hard' }],
    ])
    await vi.waitFor(async () => expect(await host.placar.carregar()).toEqual({ best: 1 }))
  })

  it('a IA fechar a linha é derrota: game_over "loss", e as vitórias não mudam', async () => {
    await montar()
    vi.useFakeTimers()
    window.__velha.start('medium')
    const st = window.__velha.state
    // A IA a um lance de fechar a linha 16-17-18-19; o jogador joga longe dela.
    st.board[16] = 2
    st.board[17] = 2
    st.board[18] = 2
    window.__velha.place(40)
    vi.advanceTimersByTime(600)
    await nextTick()
    expect(st.status).toBe('won')
    expect(st.winner).toBe(2)
    const titulo = $('.ros-velha__over-title')
    expect(titulo.classList.contains('is-lose')).toBe(true)
    expect(titulo.textContent.trim()).toBe(ptBR.aiWins)
    expect($('.ros-velha__over-sub')).toBeNull()
    expect(host.storage.getItem('roqueos:velha3d:wins')).toBeNull()
    expect(eventos('game_over').map((c) => c.args)).toEqual([
      ['game_over', { result: 'loss', difficulty: 'medium' }],
    ])
    expect(host.contar('placar', 'salvar')).toBe(0)
  })

  it('"Jogar de novo" recomeça na mesma dificuldade e com semente nova', async () => {
    // Defeito do componente antigo: o motor só era criado se ainda não
    // existisse, e o `startGame` recomeça o sorteio da semente do motor, então
    // no Fácil toda partida da mesma janela repetia os sorteios da IA.
    const sorteios = [0.11, 0.52, 0.93]
    vi.spyOn(Math, 'random').mockImplementation(() => sorteios.shift() ?? 0.5)
    await montar()
    const primeira = vencer('easy')
    await nextTick()
    $('.ros-velha__btn:not(.ros-velha__btn--ghost)').click()
    await nextTick()
    const segunda = window.__velha.state
    expect(segunda.status).toBe('playing')
    expect(segunda.difficulty).toBe('easy')
    expect(segunda.board.every((v) => v === 0)).toBe(true)
    expect(segunda.seed).not.toBe(primeira.seed)
    expect(eventos('game_start')).toHaveLength(2)
  })

  it('o menu no meio da partida volta à escolha de dificuldade e limpa o cubo', async () => {
    await montar()
    window.__velha.start('medium')
    window.__velha.place(5)
    rodar(1)
    const c = cubo()
    const marcas = () => c.children.filter((m) => m.userData.player).length
    const casasVisiveis = () => c.children.filter((m) => m.userData.cell != null && m.visible)
    expect(marcas()).toBe(1)
    expect(casasVisiveis()).toHaveLength(63)
    await nextTick()
    $('.ros-velha__icon-btn').click() // o primeiro é o menu
    await nextTick()
    expect($('.ros-velha__start')).not.toBeNull()
    expect(marcas()).toBe(0)
    expect(casasVisiveis()).toHaveLength(64)
  })

  // Do front: 'mute toggle persists'.
  it('o som liga e desliga na mesma chave de antes da extração', async () => {
    await montar()
    window.__velha.start('medium')
    await nextTick()
    const botoes = el.querySelectorAll('.ros-velha__icon-btn')
    const botao = botoes[botoes.length - 1]
    expect(botao.getAttribute('aria-label')).toBe(ptBR.soundOn)
    botao.click()
    expect(host.storage.getItem('roqueos:velha3d:muted')).toBe('1')
    await nextTick()
    expect(botao.getAttribute('aria-label')).toBe(ptBR.soundOff)
    botao.click()
    expect(host.storage.getItem('roqueos:velha3d:muted')).toBe('0')
  })

  it('lê vitórias, dificuldade e mudo das chaves de antes da extração', async () => {
    const h = criarHostFalso({ jogoId: 'velha3d' })
    h.storage.setItem('roqueos:velha3d:wins', '4')
    h.storage.setItem('roqueos:velha3d:diff', 'hard')
    h.storage.setItem('roqueos:velha3d:muted', '1')
    await montarCom(h)
    expect($('.ros-velha__start-wins').textContent).toContain('4')
    expect(window.__velha.state.difficulty).toBe('hard')
    window.__velha.start('easy')
    await nextTick()
    const botoes = el.querySelectorAll('.ros-velha__icon-btn')
    expect(botoes[botoes.length - 1].getAttribute('aria-label')).toBe(ptBR.soundOff)
    expect($('.ros-velha__wins').textContent).toContain('4')
  })

  it('as vitórias da conta, maiores que as locais, vêm para a tela e para a chave da galeria', async () => {
    const h = criarHostFalso({ jogoId: 'velha3d' })
    await h.placar.salvar({ best: 12 })
    await montarCom(h)
    await vi.waitFor(() => expect(host.storage.getItem('roqueos:velha3d:wins')).toBe('12'))
    await nextTick()
    expect($('.ros-velha__start-wins').textContent).toContain('12')
  })

  it('vitórias locais maiores que as da conta sobem na próxima vitória, e não ao abrir, como antes', async () => {
    const h = criarHostFalso({ jogoId: 'velha3d' })
    h.storage.setItem('roqueos:velha3d:wins', '3')
    await montarCom(h)
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(1))
    await nextTick()
    expect(host.contar('placar', 'salvar')).toBe(0)
    vencer()
    expect(host.storage.getItem('roqueos:velha3d:wins')).toBe('4')
    await vi.waitFor(async () => expect(await host.placar.carregar()).toEqual({ best: 4 }))
  })

  // Convidado: o host do RoqueOS devolve null no carregar e false no salvar.
  it('convidado joga com as vitórias locais, sem placar na conta', async () => {
    const h = criarHostFalso({ jogoId: 'velha3d' })
    h.placar = { carregar: vi.fn(async () => null), salvar: vi.fn(async () => false) }
    h.storage.setItem('roqueos:velha3d:wins', '2')
    await montarCom(h)
    await nextTick()
    expect($('.ros-velha__start-wins').textContent).toContain('2')
    vencer()
    await nextTick()
    expect($('.ros-velha__over-sub').textContent).toContain('3')
    expect(host.storage.getItem('roqueos:velha3d:wins')).toBe('3')
    await vi.waitFor(() => expect(h.placar.salvar).toHaveBeenCalledWith({ best: 3 }))
  })

  it('placar fora do ar não derruba o jogo nem apaga as vitórias locais', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = criarHostFalso({ jogoId: 'velha3d' })
    h.placar = {
      carregar: async () => {
        throw new Error('offline')
      },
      salvar: async () => {
        throw new Error('offline')
      },
    }
    h.storage.setItem('roqueos:velha3d:wins', '5')
    await montarCom(h)
    await vi.waitFor(() => expect(erro).toHaveBeenCalled())
    expect($('.ros-velha__start-wins').textContent).toContain('5')
    vencer()
    await nextTick()
    expect(host.storage.getItem('roqueos:velha3d:wins')).toBe('6')
  })

  it('entrar na conta com o jogo aberto busca as vitórias da conta de novo', async () => {
    await montar()
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(1))
    host.disparar('identidade', { uid: 'u1', nome: 'Ana' })
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(2))
  })

  // O modo leve é a única coisa do código de GPU que muda de origem na
  // extração: vinha do composable do RoqueOS e agora vem do host.
  it('o perfil leve do host chega no three: sem antialias e com pixel ratio de até 1,25', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    await montar({ modoLeve: true })
    expect($('.ros-velha').classList.contains('ros-velha--low')).toBe(true)
    const r = renderizador()
    expect(r.opcoes).toEqual({ antialias: false, alpha: true })
    expect(r.pixelRatio).toBe(1.25)
  })

  it('sem perfil leve o three nasce com antialias e pixel ratio de até 2', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    await montar({ modoLeve: false })
    expect($('.ros-velha').classList.contains('ros-velha--low')).toBe(false)
    const r = renderizador()
    expect(r.opcoes).toEqual({ antialias: true, alpha: true })
    expect(r.pixelRatio).toBe(2)
  })

  it('só a janela ativa desenha e gira o cubo; a que perde o foco para, e volta ao ganhar', async () => {
    await montar()
    rodar(3)
    const r = renderizador()
    const c = cubo()
    expect(r.quadros).toBe(3)
    const y0 = c.rotation.y
    rodar(2)
    expect(c.rotation.y).toBeGreaterThan(y0)

    montagem.ativar(false)
    await nextTick()
    const quadros = r.quadros
    const y1 = c.rotation.y
    rodar(5)
    expect(r.quadros).toBe(quadros)
    expect(c.rotation.y).toBe(y1)

    montagem.ativar(true)
    await nextTick()
    rodar(3)
    expect(r.quadros).toBe(quadros + 3)
  })

  // O componente de antes não ouvia teclado nenhum, e continua assim: o
  // Velha 3D se joga com o ponteiro. Com duas janelas abertas, tecla nenhuma
  // mexe em nenhuma das duas.
  it('tecla nenhuma mexe no jogo, ativo ou não', async () => {
    await montar()
    for (const key of ['Enter', ' ', 'ArrowLeft', '1']) tecla(key)
    await nextTick()
    expect(eventos('game_start')).toHaveLength(0)
    expect($('.ros-velha__start')).not.toBeNull()
    window.__velha.start('medium')
    for (const key of ['Enter', ' ', 'ArrowUp', '1']) tecla(key)
    expect(window.__velha.state.board.every((v) => v === 0)).toBe(true)
  })

  // Do front: 'cleans up the E2E hook on unmount'.
  it('desmontar solta tudo: o gancho, o contexto WebGL, os materiais, a IA pendente e a tela', async () => {
    await montar()
    vi.useFakeTimers()
    window.__velha.start('medium')
    const st = window.__velha.state
    window.__velha.place(0)
    rodar(1)
    const r = renderizador()
    const materiais = cubo().children.map((m) => m.material)
    expect(window.__velha).toBeTruthy()
    montagem.desmontar()
    expect(window.__velha).toBeUndefined()
    expect(r.descartado).toBe(true)
    expect(materiais.length).toBe(65)
    expect(materiais.every((m) => m.descartado)).toBe(true)
    expect(el.querySelector('.ros-velha')).toBeNull()
    expect(el.querySelector('canvas')).toBeNull()
    // A resposta da IA que estava no relógio não chega a jogar.
    vi.advanceTimersByTime(1000)
    expect(st.board.filter((v) => v === 2)).toHaveLength(0)
    // Desmontar de novo acontece de verdade (a janela fecha e o componente em
    // volta desmonta depois) e não pode lançar.
    expect(() => montagem.desmontar()).not.toThrow()
  })

  it('desmontar antes de o texto chegar não monta nada depois', async () => {
    host = criarHostFalso({ jogoId: 'velha3d' })
    montagem = jogo.mount(palco(), host, { ativo: true })
    montagem.desmontar()
    await new Promise((r) => setTimeout(r, 50))
    expect(el.querySelector('.ros-velha')).toBeNull()
  })

  it('toda chave que a tela usa existe no pt-BR, as três dificuldades inclusive', () => {
    const usadas = [...tela.matchAll(/txt\('([\w.]+)'/g)].map((m) => m[1])
    expect(usadas.length).toBeGreaterThan(10)
    // `txt(\`diff.${d}\`)` monta a chave em tempo de execução; a busca acima não a vê.
    const dificuldades = ['easy', 'medium', 'hard'].map((d) => `diff.${d}`)
    const faltando = [...usadas, ...dificuldades].filter((k) => traduzir(ptBR, k) === k)
    expect(faltando).toEqual([])
  })
})
