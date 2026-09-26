<template>
  <div
    ref="rootRef"
    class="ros-velha"
    :class="{ 'ros-velha--low': modoLeve }"
    :dir="estado.idioma === 'ar-AR' ? 'rtl' : 'ltr'"
  >
    <div ref="canvasHost" class="ros-velha__canvas" />

    <!-- top-right controls -->
    <div v-if="status !== 'ready'" class="ros-velha__top-actions">
      <button class="ros-velha__icon-btn" :aria-label="txt('menu')" @click="toMenu">
        <Icone nome="grade" :tamanho="18" />
      </button>
      <button
        class="ros-velha__icon-btn"
        :aria-label="muted ? txt('soundOff') : txt('soundOn')"
        @click="toggleMute"
      >
        <Icone :nome="muted ? 'mudo' : 'som'" :tamanho="18" />
      </button>
    </div>

    <!-- HUD: whose turn -->
    <div v-if="status === 'playing'" class="ros-velha__hud" aria-hidden="true">
      <span class="ros-velha__turn-dot" :class="turn === human ? 'is-you' : 'is-ai'" />
      <span class="ros-velha__turn">{{ thinking ? txt('aiThinking') : txt('yourTurn') }}</span>
      <span v-if="wins > 0" class="ros-velha__wins">👑 {{ wins }}</span>
    </div>

    <!-- Start / difficulty -->
    <div v-if="status === 'ready'" class="ros-velha__start">
      <div class="ros-velha__logo">{{ txt('title') }}</div>
      <div class="ros-velha__tagline">{{ txt('tagline') }}</div>
      <div class="ros-velha__diffs">
        <button
          v-for="d in DIFFS"
          :key="d"
          class="ros-velha__diff"
          :class="`ros-velha__diff--${d}`"
          @click="start(d)"
        >
          {{ txt(`diff.${d}`) }}
        </button>
      </div>
      <div v-if="wins > 0" class="ros-velha__start-wins">👑 {{ txt('wins') }} · {{ wins }}</div>
    </div>

    <!-- Result overlay -->
    <transition name="velha-pop">
      <div v-if="status === 'won' || status === 'draw'" class="ros-velha__over">
        <div
          class="ros-velha__over-title"
          :class="{
            'is-win': status === 'won' && winner === human,
            'is-lose': status === 'won' && winner === ai,
          }"
        >
          {{ status === 'draw' ? txt('draw') : winner === human ? txt('youWin') : txt('aiWins') }}
        </div>
        <div v-if="status === 'won' && winner === human" class="ros-velha__over-sub">
          👑 {{ txt('wins') }} · {{ wins }}
        </div>
        <div class="ros-velha__over-actions">
          <button class="ros-velha__btn ros-velha__btn--ghost" @click="toMenu">
            {{ txt('menu') }}
          </button>
          <button class="ros-velha__btn" @click="start(difficulty)">
            <Icone nome="reiniciar" :tamanho="19" />
            {{ txt('again') }}
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
// O Velha 3D. Fala com o sistema só pelo `host` do jogo-sdk: placar, áudio,
// modo leve, métricas e armazenamento chegam por ele, e é por isso que o mesmo
// arquivo roda dentro do RoqueOS, no `yarn dev` do repo e no teste.
//
// O que toca a GPU (renderer e as opções dele, pixel ratio, tamanho do canvas,
// luzes, materiais, geometrias, a linha da vitória e o corte de qualidade do
// modo leve) veio do componente do RoqueOS SEM MUDANÇA, em 25/09/2026. Só
// mudou de onde vêm o modo leve, o áudio, o texto e o placar. Mexer ali pede
// teste no iPhone de verdade antes de subir: verde no desktop não é verde no
// iPhone.
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { emModoE2E } from '@roqueos-games/jogo-sdk'
import { createGame, startGame, place, aiMove, coord, CELLS } from './engine.js'
import { criarSom } from './som.js'
import { traduzir } from './textos.js'
import Icone from './Icone.vue'

const props = defineProps({
  /** O host do contrato v1 do jogo-sdk. */
  host: { type: Object, required: true },
  /** `{ ativo, idioma, textos }`, reativo; quem escreve é o `montar` do jogo. */
  estado: { type: Object, required: true },
})

// O `initThree` lá embaixo tem um `host` só dele (o elemento do canvas) que
// esconde este dentro da função. Ficou assim porque aquele trecho é código de
// GPU e viaja sem mudança; ele não usa o host do SDK.
const host = props.host
const txt = (chave, valores) => traduzir(props.estado.textos, chave, valores)

const DIFFS = ['easy', 'medium', 'hard']
const SPACING = 1.35
const COLOR_HUMAN = 0x22d3ee
const COLOR_AI = 0xff7a3c

// ── Reactive UI ──────────────────────────────────────────────────────────────
const rootRef = ref(null)
const canvasHost = ref(null)
const status = ref('ready')
const difficulty = ref('medium')
const turn = ref(1)
const winner = ref(0)
const thinking = ref(false)
const muted = ref(false)
const wins = ref(0)
const human = 1
const ai = 2
// O perfil leve para o CSS. O `lowEnd` de baixo é o mesmo valor, para o three
// e para o tempo de resposta da IA.
const modoLeve = ref(false)

// ── Engine + Three (plain) ───────────────────────────────────────────────────
let game = null
let lowEnd = false
let renderer = null
let scene = null
let camera = null
let cubeGroup = null
let slotMeshes = []
let markMeshes = []
let winLine = null
let raycaster = null
let slotGeo = null
let humanGeo = null
let aiGeo = null
let disposables = []
let rafId = 0
let running = false
let lastT = 0
let resizeObserver = null
let pararIdentidade = null
let autoSpin = 0.16
let winPulse = 0

const pendingTimers = new Set()
const later = (fn, ms) => {
  const id = setTimeout(() => {
    pendingTimers.delete(id)
    fn()
  }, ms)
  pendingTimers.add(id)
  return id
}

const worldOf = (i) => {
  const { x, y, z } = coord(i)
  return { x: (x - 1.5) * SPACING, y: (y - 1.5) * SPACING, z: (z - 1.5) * SPACING }
}

// ── Audio ────────────────────────────────────────────────────────────────────
const som = criarSom(host.audio, () => muted.value)

// Chamado de dentro do gesto (clique, toque), sem `await` antes: o iOS só
// libera o áudio assim.
const primeAudio = () => {
  try {
    host.audio.destravar()?.catch?.(() => {})
  } catch {
    /* best-effort */
  }
}
const buzz = (p) => {
  try {
    navigator.vibrate?.(p)
  } catch {
    /* best-effort */
  }
}
// A chave `muted` vira `roqueos:velha3d:muted` no host, a mesma de antes da
// extração.
const toggleMute = () => {
  muted.value = !muted.value
  host.armazenamento.gravar('muted', muted.value ? '1' : '0')
}

// ── Three setup ──────────────────────────────────────────────────────────────
const track = (o) => {
  disposables.push(o)
  return o
}

const initThree = () => {
  const host = canvasHost.value
  const w = host.clientWidth || 480
  const h = host.clientHeight || 620

  renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 2))
  renderer.setSize(w, h)
  host.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)
  camera.position.set(0, 0, 9)
  camera.lookAt(0, 0, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const key = new THREE.DirectionalLight(0xffffff, 0.9)
  key.position.set(4, 6, 8)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6688ff, 0.5)
  rim.position.set(-6, -2, 4)
  scene.add(rim)

  cubeGroup = new THREE.Group()
  cubeGroup.rotation.x = -0.35
  cubeGroup.rotation.y = 0.6
  scene.add(cubeGroup)

  raycaster = new THREE.Raycaster()
  slotGeo = track(new THREE.SphereGeometry(0.42, 12, 12))
  humanGeo = track(new THREE.IcosahedronGeometry(0.34, 0))
  aiGeo = track(new THREE.SphereGeometry(0.36, 18, 18))

  // 64 faint slot spheres = the lattice + raycast hit targets
  for (let i = 0; i < CELLS; i++) {
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x8892b0),
        transparent: true,
        opacity: 0.07,
        roughness: 0.6,
        metalness: 0,
      }),
    )
    const m = new THREE.Mesh(slotGeo, mat)
    const w2 = worldOf(i)
    m.position.set(w2.x, w2.y, w2.z)
    m.userData.cell = i
    cubeGroup.add(m)
    slotMeshes.push(m)
  }
}

const addMark = (cell, player) => {
  const geo = player === human ? humanGeo : aiGeo
  const hex = player === human ? COLOR_HUMAN : COLOR_AI
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    emissive: new THREE.Color(hex),
    emissiveIntensity: 0.45,
    roughness: 0.3,
    metalness: 0.15,
  })
  disposables.push(mat)
  const m = new THREE.Mesh(geo, mat)
  const w2 = worldOf(cell)
  m.position.set(w2.x, w2.y, w2.z)
  m.userData.player = player
  cubeGroup.add(m)
  markMeshes[cell] = m
  if (slotMeshes[cell]) slotMeshes[cell].visible = false
}

const clearBoard3D = () => {
  for (const m of markMeshes) {
    if (m) {
      cubeGroup.remove(m)
      m.material?.dispose?.()
    }
  }
  markMeshes = []
  for (const s of slotMeshes) s.visible = true
  if (winLine) {
    cubeGroup.remove(winLine)
    winLine.geometry?.dispose?.()
    winLine.material?.dispose?.()
    winLine = null
  }
}

const drawWinLine = (line) => {
  const pts = []
  for (const c of line) {
    const w2 = worldOf(c)
    pts.push(w2.x, w2.y, w2.z)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(0xffffff),
    transparent: true,
    opacity: 0.9,
  })
  winLine = new THREE.Line(geo, mat)
  cubeGroup.add(winLine)
}

// ── Loop ─────────────────────────────────────────────────────────────────────
const resize = () => {
  if (!renderer || !camera || !canvasHost.value) return
  const w = canvasHost.value.clientWidth || 480
  const h = canvasHost.value.clientHeight || 620
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

const loop = (now) => {
  if (!running) return
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0
  lastT = now
  if (cubeGroup && !dragging && props.estado.ativo) {
    cubeGroup.rotation.y += dt * autoSpin
  }
  if (status.value === 'won' && winLine) {
    winPulse += dt * 4
    const p = 0.6 + 0.4 * Math.abs(Math.sin(winPulse))
    for (const c of game.winningLine || []) {
      const m = markMeshes[c]
      if (m) m.material.emissiveIntensity = 0.4 + p * 0.9
    }
    if (winLine.material) winLine.material.opacity = 0.5 + p * 0.5
  }
  if (renderer && scene && camera) renderer.render(scene, camera)
  rafId = requestAnimationFrame(loop)
}
const startLoop = () => {
  if (running || !renderer) return
  running = true
  lastT = 0
  rafId = requestAnimationFrame(loop)
}
const stopLoop = () => {
  running = false
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

// ── Turn flow ────────────────────────────────────────────────────────────────
const doPlace = (cell, player) => {
  const r = place(game, cell)
  if (!r.ok) return false
  addMark(cell, player)
  som.bip(player === human ? 560 : 340, 'triangle', 0.12, 0.12)
  buzz(6)
  turn.value = game.turn
  if (r.win) {
    endGame('won', player, r.line)
  } else if (r.draw) {
    endGame('draw', 0, null)
  }
  return true
}

const aiTurn = () => {
  if (status.value !== 'playing') return
  thinking.value = true
  later(
    () => {
      if (status.value !== 'playing') {
        thinking.value = false
        return
      }
      const m = aiMove(game)
      doPlace(m, ai)
      thinking.value = false
    },
    lowEnd ? 250 : 480,
  )
}

const humanPick = (cell) => {
  if (status.value !== 'playing' || turn.value !== human || thinking.value) return
  if (game.board[cell] !== 0) return
  primeAudio()
  if (doPlace(cell, human) && status.value === 'playing') aiTurn()
}

const endGame = (result, who, line) => {
  status.value = result
  winner.value = who
  winPulse = 0
  if (result === 'won' && line) drawWinLine(line)
  if (result === 'won' && who === human) {
    wins.value += 1
    persistWins()
    som.fanfarra(true)
    buzz([20, 40, 20, 60])
  } else if (result === 'won') {
    som.fanfarra(false)
    buzz([40, 60])
  } else {
    som.bip(300, 'sine', 0.12, 0.3)
  }
  host.metricas.evento('game_over', {
    result: result === 'draw' ? 'draw' : who === human ? 'win' : 'loss',
    difficulty: difficulty.value,
  })
}

// ── Game flow ────────────────────────────────────────────────────────────────
const start = (diff) => {
  primeAudio()
  difficulty.value = diff
  // Semente nova a cada partida. Antes o motor só era criado se ainda não
  // houvesse um, e o do onMounted sempre havia; como o `startGame` recomeça o
  // sorteio da mesma semente, todo "Jogar de novo" no Fácil repetia os lances
  // sorteados da IA da primeira partida. Defeito do componente antigo, achado
  // na extração em 25/09/2026 (o mesmo do Prisma).
  game = createGame({ difficulty: diff, seed: Math.floor(Math.random() * 1e9) || 1 })
  game.difficulty = diff
  startGame(game, human)
  clearBoard3D()
  status.value = 'playing'
  turn.value = human
  winner.value = 0
  thinking.value = false
  host.armazenamento.gravar('diff', diff)
  host.metricas.evento('game_start', { difficulty: diff })
}

const toMenu = () => {
  status.value = 'ready'
  clearBoard3D()
}

// ── Orbit + pick input ───────────────────────────────────────────────────────
let dragging = false
let moved = false
let downX = 0
let downY = 0

const onPointerDown = (e) => {
  if (e.target.closest('button')) return
  dragging = true
  moved = false
  downX = e.clientX
  downY = e.clientY
}
const onPointerMove = (e) => {
  if (!dragging || !cubeGroup) return
  const dx = e.clientX - downX
  const dy = e.clientY - downY
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true
  if (moved) {
    cubeGroup.rotation.y += dx * 0.008
    cubeGroup.rotation.x = Math.max(-1.2, Math.min(1.2, cubeGroup.rotation.x + dy * 0.008))
    downX = e.clientX
    downY = e.clientY
  }
}
const onPointerUp = (e) => {
  if (dragging && !moved) pickAt(e.clientX, e.clientY)
  dragging = false
}

const pickAt = (clientX, clientY) => {
  if (!raycaster || !camera || status.value !== 'playing') return
  const rect = renderer.domElement.getBoundingClientRect()
  const ndc = {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  }
  raycaster.setFromCamera(ndc, camera)
  const targets = slotMeshes.filter((m) => m.visible)
  const hits = raycaster.intersectObjects(targets, false)
  if (hits && hits.length) {
    const cell = hits[0].object.userData.cell
    if (cell != null) humanPick(cell)
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────
// As chaves `wins`, `diff` e `muted` viram `roqueos:velha3d:wins` e as outras
// duas no host, as mesmas de antes da extração: quem já jogava não perde as
// vitórias, e a galeria continua lendo o recorde de `wins`.
const loadLocal = () => {
  muted.value = host.armazenamento.ler('muted') === '1'
  wins.value = parseInt(host.armazenamento.ler('wins'), 10) || 0
  const d = host.armazenamento.ler('diff')
  if (DIFFS.includes(d)) difficulty.value = d
}
// Na conta, as vitórias vão no campo `best`, como antes da extração.
const persistWins = () => {
  host.armazenamento.gravar('wins', String(wins.value))
  Promise.resolve()
    .then(() => host.placar.salvar({ best: wins.value }))
    .catch(() => {})
}
// A conta ganha do local quando tem mais vitórias. O contrário não sobe aqui,
// e isso é de antes da extração: o local maior só chega à conta na próxima
// vitória, pelo `persistWins`. Convidado não tem placar na conta: o host
// devolve null.
const syncRemote = async () => {
  try {
    const remoto = await host.placar.carregar()
    const daConta = Number(remoto?.best) || 0
    if (daConta > wins.value) {
      wins.value = daConta
      host.armazenamento.gravar('wins', String(daConta))
    }
  } catch (err) {
    console.error('[Velha3D] Score sync failed:', err)
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
// A janela que perde o foco para de desenhar; a que ganha volta. O `ativo` vem
// do host (a janela em foco, no RoqueOS).
watch(
  () => props.estado.ativo,
  (active) => {
    if (!active) stopLoop()
    else startLoop()
  },
)
const onVisibility = () => {
  if (document.hidden) stopLoop()
  else if (props.estado.ativo) startLoop()
}

onMounted(() => {
  lowEnd = Boolean(host.desempenho.modoLeve())
  modoLeve.value = lowEnd
  loadLocal()
  game = createGame({ difficulty: difficulty.value, seed: Math.floor(Math.random() * 1e9) || 1 })
  initThree()
  syncRemote()
  // Quem entra na conta com o jogo aberto vê as vitórias da conta sem reabrir.
  pararIdentidade = host.identidade.aoMudar(() => syncRemote())
  startLoop()

  rootRef.value.addEventListener('pointerdown', onPointerDown)
  rootRef.value.addEventListener('pointermove', onPointerMove)
  rootRef.value.addEventListener('pointerup', onPointerUp)
  rootRef.value.addEventListener('pointerleave', onPointerUp)
  document.addEventListener('visibilitychange', onVisibility)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvasHost.value)

  if (emModoE2E()) {
    window.__velha = {
      get state() {
        return game
      },
      start,
      place: (cell) => humanPick(cell),
      aiStep: () => {
        if (status.value === 'playing') {
          const m = aiMove(game)
          doPlace(m, game.turn)
        }
      },
      // Cover aid: a lively mid-game cube with several marks of each side.
      stage: () => {
        start('medium')
        const hum = [21, 22, 26, 41, 5]
        const aic = [42, 38, 25, 9, 58]
        for (const c of hum)
          if (game.board[c] === 0) {
            game.board[c] = human
            addMark(c, human)
          }
        for (const c of aic)
          if (game.board[c] === 0) {
            game.board[c] = ai
            addMark(c, ai)
          }
        game.turn = human
        turn.value = human
        if (cubeGroup) {
          cubeGroup.rotation.x = -0.4
          cubeGroup.rotation.y = 0.7
        }
        autoSpin = 0
      },
    }
  }
})

onUnmounted(() => {
  stopLoop()
  for (const id of pendingTimers) clearTimeout(id)
  pendingTimers.clear()
  rootRef.value?.removeEventListener('pointerdown', onPointerDown)
  rootRef.value?.removeEventListener('pointermove', onPointerMove)
  rootRef.value?.removeEventListener('pointerup', onPointerUp)
  rootRef.value?.removeEventListener('pointerleave', onPointerUp)
  document.removeEventListener('visibilitychange', onVisibility)
  resizeObserver?.disconnect()
  pararIdentidade?.()
  clearBoard3D()
  for (const d of disposables) {
    try {
      d.dispose?.()
    } catch {
      /* best-effort */
    }
  }
  disposables = []
  slotMeshes = []
  try {
    renderer?.dispose?.()
    if (renderer?.domElement?.parentNode)
      renderer.domElement.parentNode.removeChild(renderer.domElement)
  } catch {
    /* best-effort */
  }
  renderer = null
  scene = null
  camera = null
  if (emModoE2E()) delete window.__velha
})
</script>

<style scoped lang="scss">
.ros-velha {
  // Cores de identidade do jogo, como custom property para que um tema consiga
  // alcançá-las. As que vêm do sistema herdam o token do RoqueOS quando ele
  // existe e caem no valor que o tema padrão do RoqueOS dá, em 25/09/2026,
  // quando o jogo roda sozinho: fora do RoqueOS não há `tokens-root.scss`
  // nenhum carregado.
  --ros-velha-texto: var(--ros-text, rgba(255, 255, 255, 0.95));
  --ros-velha-texto-100: var(--ros-text-100, #ffffff);
  --ros-velha-texto-suave: var(--ros-text-muted, rgba(255, 255, 255, 0.72));
  --ros-velha-borda-sutil: var(--ros-border-subtle, rgba(255, 255, 255, 0.12));
  --ros-velha-preenchimento-10: var(--ros-fill-10, rgba(255, 255, 255, 0.1));
  --ros-velha-sombra-60: var(--ros-shadow-60, rgba(0, 0, 0, 0.6));
  --ros-velha-veu-30: var(--ros-scrim-30, rgba(0, 0, 0, 0.3));
  --ros-velha-veu-50: var(--ros-scrim-50, rgba(0, 0, 0, 0.5));
  --ros-velha-veu-55: var(--ros-scrim-55, rgba(0, 0, 0, 0.55));
  --ros-velha-preto-rgb: var(--ros-black-rgb, 0, 0, 0);
  --ros-velha-desfoque: var(--ros-backdrop-blur, blur(20px));
  --ros-velha-bg-1: rgba(34, 211, 238, 0.12);
  --ros-velha-bg-2: rgba(255, 122, 60, 0.1);
  --ros-velha-bg-3: #0a0d14;
  --ros-velha-bg-4: #06070d;
  --ros-velha-bg-5: #22d3ee;
  --ros-velha-shadow-1: rgba(34, 211, 238, 0.8);
  --ros-velha-bg-6: #ff7a3c;
  --ros-velha-shadow-2: rgba(255, 122, 60, 0.8);
  --ros-velha-fg-1: #ffd166;
  --ros-velha-bg-7: #60a5fa;
  --ros-velha-shadow-3: rgba(34, 211, 238, 0.4);
  --ros-velha-bg-8: rgba(26, 26, 34, 0.7);
  --ros-velha-line-1: rgba(74, 222, 128, 0.6);
  --ros-velha-shadow-4: rgba(74, 222, 128, 0.22);
  --ros-velha-line-2: rgba(96, 165, 250, 0.6);
  --ros-velha-shadow-5: rgba(96, 165, 250, 0.22);
  --ros-velha-line-3: rgba(255, 122, 60, 0.6);
  --ros-velha-shadow-6: rgba(255, 122, 60, 0.22);
  --ros-velha-fg-2: #4ade80;
  --ros-velha-bg-9: #3b82f6;
}

.ros-velha {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  cursor: grab;
  background: radial-gradient(120% 90% at 50% -10%, var(--ros-velha-bg-1), transparent 55%),
    radial-gradient(120% 90% at 50% 112%, var(--ros-velha-bg-2), transparent 55%),
    linear-gradient(180deg, var(--ros-velha-bg-3) 0%, var(--ros-velha-bg-4) 100%);

  &:active {
    cursor: grabbing;
  }

  &__canvas {
    position: absolute;
    inset: 0;

    :deep(canvas) {
      display: block;
      width: 100% !important;
      height: 100% !important;
    }
  }

  &__top-actions {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    gap: 8px;
    z-index: 6;

    @media (max-width: 768px) {
      top: 52px;
    }
  }

  &__icon-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: rgba(var(--ros-velha-preto-rgb), 0.32);
    color: var(--ros-velha-texto-suave);
    cursor: pointer;
    transition: background 0.15s ease;

    &:hover {
      background: var(--ros-velha-veu-55);
      color: var(--ros-velha-texto);
    }
  }

  &__hud {
    position: absolute;
    top: 16px;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    pointer-events: none;
  }

  &__turn-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;

    &.is-you {
      background: var(--ros-velha-bg-5);
      box-shadow: 0 0 10px var(--ros-velha-shadow-1);
    }
    &.is-ai {
      background: var(--ros-velha-bg-6);
      box-shadow: 0 0 10px var(--ros-velha-shadow-2);
    }
  }

  &__turn {
    font-size: 14px;
    font-weight: 700;
    color: var(--ros-velha-texto);
  }

  &__wins {
    font-size: 12px;
    font-weight: 700;
    color: var(--ros-velha-fg-1);
    margin-left: 6px;
  }

  // ── Start ───────────────────────────────────────────────────────────────────
  &__start {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    z-index: 5;
    padding: 24px;
  }

  &__logo {
    font-size: clamp(38px, 10vw, 56px);
    font-weight: 800;
    letter-spacing: 5px;
    background: linear-gradient(
      120deg,
      var(--ros-velha-bg-5) 5%,
      var(--ros-velha-bg-7) 50%,
      var(--ros-velha-bg-6) 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 4px 26px var(--ros-velha-shadow-3));
    text-align: center;
  }

  &__tagline {
    font-size: 14px;
    font-weight: 500;
    color: var(--ros-velha-texto-suave);
    margin-bottom: 22px;
    text-align: center;
    max-width: 340px;
  }

  &__diffs {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: center;
  }

  &__diff {
    padding: 12px 22px;
    border: 1px solid var(--ros-velha-borda-sutil);
    border-radius: 14px;
    background: var(--ros-velha-bg-8);
    color: var(--ros-velha-texto);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition:
      transform 0.16s ease,
      border-color 0.16s ease,
      box-shadow 0.16s ease;

    &:hover {
      transform: translateY(-3px);
    }
    &--easy:hover {
      border-color: var(--ros-velha-line-1);
      box-shadow: 0 12px 30px var(--ros-velha-shadow-4);
    }
    &--medium:hover {
      border-color: var(--ros-velha-line-2);
      box-shadow: 0 12px 30px var(--ros-velha-shadow-5);
    }
    &--hard:hover {
      border-color: var(--ros-velha-line-3);
      box-shadow: 0 12px 30px var(--ros-velha-shadow-6);
    }
  }

  &__start-wins {
    margin-top: 22px;
    font-size: 14px;
    font-weight: 600;
    color: var(--ros-velha-texto);
    background: var(--ros-velha-veu-30);
    padding: 6px 14px;
    border-radius: 999px;
  }

  // ── Over ────────────────────────────────────────────────────────────────────
  &__over {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--ros-velha-veu-50);
    backdrop-filter: var(--ros-velha-desfoque);
    -webkit-backdrop-filter: var(--ros-velha-desfoque);
    z-index: 7;
  }

  &__over-title {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: 0.5px;
    color: var(--ros-velha-texto-100);
    text-shadow: 0 2px 18px var(--ros-velha-sombra-60);

    &.is-win {
      color: var(--ros-velha-fg-2);
    }
    &.is-lose {
      color: var(--ros-velha-bg-6);
    }
  }

  &__over-sub {
    font-size: 14px;
    font-weight: 600;
    color: var(--ros-velha-texto-suave);
    margin-bottom: 12px;
  }

  &__over-actions {
    display: flex;
    gap: 12px;
  }

  &__btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 11px 22px;
    border: none;
    border-radius: 999px;
    background: linear-gradient(135deg, var(--ros-velha-bg-5), var(--ros-velha-bg-9));
    color: var(--ros-velha-texto-100);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 6px 22px var(--ros-velha-shadow-3);
    transition: transform 0.15s ease;

    &:hover {
      transform: translateY(-2px);
    }

    &--ghost {
      background: var(--ros-velha-preenchimento-10);
      box-shadow: none;
      color: var(--ros-velha-texto);
    }
  }
}

.velha-pop-enter-active {
  transition:
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.3s ease;
}
.velha-pop-enter-from {
  transform: scale(0.8);
  opacity: 0;
}

// O perfil leve vem do host (`desempenho.modoLeve`), não do atributo que o
// RoqueOS põe no <html>: fora do RoqueOS esse atributo não existe.
.ros-velha--low {
  .ros-velha__over {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: rgba(var(--ros-velha-preto-rgb), 0.72);
  }
}
</style>
