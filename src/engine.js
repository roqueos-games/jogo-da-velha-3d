/**
 * VELHA 3D — pure, deterministic engine for the RoqueOS Games gallery.
 *
 * Three-dimensional tic-tac-toe on a 4×4×4 cube (Qubic): get four of your marks
 * in a straight line **anywhere in space** — along any axis, any face diagonal,
 * or a space diagonal through the cube (76 winning lines in total). Ships with a
 * heuristic AI (take the win, block the threat, build/deny forks, then a
 * line-potential heuristic with a shallow look-ahead on Hard). Framework-free
 * and fully unit-testable; the component owns the Three.js cube, orbit + picking
 * and sound.
 */

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const SIZE = 4
export const CELLS = SIZE * SIZE * SIZE // 64

export const idx = (x, y, z) => x + y * SIZE + z * SIZE * SIZE
export const coord = (i) => ({
  x: i % SIZE,
  y: Math.floor(i / SIZE) % SIZE,
  z: Math.floor(i / (SIZE * SIZE)),
})

/** All 76 straight lines of four on the 4×4×4 cube. */
export function generateLines() {
  const lines = []
  const n = SIZE
  // Direction vectors for a line's step (only "positive" canonical directions).
  const dirs = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 0],
    [1, -1, 0],
    [1, 0, 1],
    [1, 0, -1],
    [0, 1, 1],
    [0, 1, -1],
    [1, 1, 1],
    [1, 1, -1],
    [1, -1, 1],
    [1, -1, -1],
  ]
  const seen = new Set()
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      for (let z = 0; z < n; z++) {
        for (const [dx, dy, dz] of dirs) {
          const cells = []
          let ok = true
          for (let s = 0; s < n; s++) {
            const cx = x + dx * s
            const cy = y + dy * s
            const cz = z + dz * s
            if (cx < 0 || cx >= n || cy < 0 || cy >= n || cz < 0 || cz >= n) {
              ok = false
              break
            }
            cells.push(idx(cx, cy, cz))
          }
          if (!ok) continue
          const key = cells
            .slice()
            .sort((a, b) => a - b)
            .join(',')
          if (seen.has(key)) continue
          seen.add(key)
          lines.push(cells)
        }
      }
    }
  }
  return lines
}

export const LINES = generateLines()

// For each cell, the lines that pass through it (speeds up evaluation).
export const LINES_THROUGH = (() => {
  const map = Array.from({ length: CELLS }, () => [])
  LINES.forEach((line, li) => {
    for (const c of line) map[c].push(li)
  })
  return map
})()

export function createGame(opts = {}) {
  const difficulty = ['easy', 'medium', 'hard'].includes(opts.difficulty)
    ? opts.difficulty
    : 'medium'
  return {
    status: 'idle', // 'idle' | 'playing' | 'won' | 'draw'
    board: new Array(CELLS).fill(0), // 0 empty, 1 player, 2 AI
    turn: 1, // whose move it is
    human: 1,
    ai: 2,
    winner: 0,
    winningLine: null,
    difficulty,
    moves: 0,
    seed: (opts.seed || 1) >>> 0,
    rng: mulberry32(opts.seed || 1),
  }
}

export function startGame(state, firstPlayer = 1) {
  state.board = new Array(CELLS).fill(0)
  state.turn = firstPlayer
  state.winner = 0
  state.winningLine = null
  state.moves = 0
  state.rng = mulberry32(state.seed)
  state.status = 'playing'
  return state
}

/** Returns the winning line (array of 4 cells) for `player`, or null. */
export function winningLineFor(board, player) {
  for (const line of LINES) {
    if (
      board[line[0]] === player &&
      board[line[1]] === player &&
      board[line[2]] === player &&
      board[line[3]] === player
    ) {
      return line
    }
  }
  return null
}

export const isFull = (board) => board.every((c) => c !== 0)

/** Place the current player's mark at cell `i`. */
export function place(state, i) {
  if (state.status !== 'playing') return { ok: false }
  if (i < 0 || i >= CELLS || state.board[i] !== 0) return { ok: false }
  const player = state.turn
  state.board[i] = player
  state.moves += 1
  const line = winningLineFor(state.board, player)
  if (line) {
    state.status = 'won'
    state.winner = player
    state.winningLine = line
    return { ok: true, win: true, player, line }
  }
  if (isFull(state.board)) {
    state.status = 'draw'
    return { ok: true, draw: true }
  }
  state.turn = player === 1 ? 2 : 1
  return { ok: true }
}

const emptyCells = (board) => {
  const out = []
  for (let i = 0; i < CELLS; i++) if (board[i] === 0) out.push(i)
  return out
}

/** A cell that immediately completes a line of four for `player`, or -1. */
export function findWinningMove(board, player) {
  for (const line of LINES) {
    let count = 0
    let empty = -1
    for (const c of line) {
      if (board[c] === player) count++
      else if (board[c] === 0) empty = c
      else {
        count = -99
        break
      }
    }
    if (count === 3 && empty >= 0) return empty
  }
  return -1
}

/** Count how many distinct lines would become an immediate win threat if
 * `player` played at `cell` (used for fork detection). */
function threatsAfter(board, cell, player) {
  const b = board.slice()
  b[cell] = player
  let threats = 0
  for (const li of LINES_THROUGH[cell]) {
    const line = LINES[li]
    let count = 0
    let ok = true
    for (const c of line) {
      if (b[c] === player) count++
      else if (b[c] !== 0) {
        ok = false
        break
      }
    }
    if (ok && count === 3) threats++
  }
  return threats
}

/** A move that creates two+ simultaneous winning threats (an unstoppable fork). */
export function findFork(board, player) {
  for (const cell of emptyCells(board)) {
    if (threatsAfter(board, cell, player) >= 2) return cell
  }
  return -1
}

/** Static line-potential heuristic: reward lines you can still win, weighted by
 * how many marks you already have; penalise the opponent's open lines. */
export function heuristicScore(board, player) {
  const opp = player === 1 ? 2 : 1
  const weight = [0, 1, 8, 40, 100000]
  let score = 0
  for (const line of LINES) {
    let mine = 0
    let theirs = 0
    for (const c of line) {
      if (board[c] === player) mine++
      else if (board[c] === opp) theirs++
    }
    if (mine > 0 && theirs === 0) score += weight[mine]
    else if (theirs > 0 && mine === 0) score -= weight[theirs] * 0.9
  }
  return score
}

function bestByHeuristic(board, player) {
  let best = -Infinity
  let move = -1
  for (const cell of emptyCells(board)) {
    const b = board.slice()
    b[cell] = player
    const s = heuristicScore(b, player)
    if (s > best) {
      best = s
      move = cell
    }
  }
  return move
}

/** One-ply-deeper search on Hard: after our candidate, assume the opponent
 * plays its best reply, and keep the move with the best resulting position. */
function bestWithLookahead(board, player) {
  const opp = player === 1 ? 2 : 1
  let best = -Infinity
  let move = -1
  // Only consider a promising subset (cells touching our/enemy marks) for speed.
  const cells = emptyCells(board)
  const candidates = cells.filter((c) =>
    LINES_THROUGH[c].some((li) => LINES[li].some((cc) => board[cc] !== 0)),
  )
  const pool = candidates.length ? candidates : cells
  for (const cell of pool) {
    const b = board.slice()
    b[cell] = player
    if (winningLineFor(b, player)) return cell
    // opponent's best immediate reply
    let oppBest = -Infinity
    const oppWin = findWinningMove(b, opp)
    if (oppWin >= 0) {
      oppBest = 100000
    } else {
      for (const oc of emptyCells(b)) {
        const bb = b.slice()
        bb[oc] = opp
        const s = heuristicScore(bb, opp)
        // Math.max: aqui só o VALOR importa (não há célula a guardar junto),
        // então `>` e `>=` decidiam o mesmo. As outras duas comparações deste
        // arquivo guardam também a jogada, e nelas o desempate importa.
        oppBest = Math.max(oppBest, s)
      }
    }
    const myScore = heuristicScore(b, player)
    const net = myScore - oppBest * 0.95
    if (net > best) {
      best = net
      move = cell
    }
  }
  return move
}

/** Pick the AI's move for the current position. */
export function aiMove(state) {
  const board = state.board
  const me = state.turn
  const opp = me === 1 ? 2 : 1
  const diff = state.difficulty

  // Always take an immediate win.
  const win = findWinningMove(board, me)
  if (win >= 0) return win

  if (diff === 'easy') {
    // Block only half the time, otherwise a plausible-but-soft move.
    const block = findWinningMove(board, opp)
    if (block >= 0 && state.rng() < 0.5) return block
    const empties = emptyCells(board)
    // prefer a cell adjacent to existing marks, else random
    const near = empties.filter((c) =>
      LINES_THROUGH[c].some((li) => LINES[li].some((cc) => board[cc] !== 0)),
    )
    const pool = near.length ? near : empties
    return pool[Math.floor(state.rng() * pool.length)]
  }

  // Medium / Hard: always block, then look for a fork, then deny theirs.
  const block = findWinningMove(board, opp)
  if (block >= 0) return block
  const fork = findFork(board, me)
  if (fork >= 0) return fork
  const oppFork = findFork(board, opp)
  if (oppFork >= 0) return oppFork

  return diff === 'hard' ? bestWithLookahead(board, me) : bestByHeuristic(board, me)
}

export const isOver = (state) => state.status === 'won' || state.status === 'draw'
