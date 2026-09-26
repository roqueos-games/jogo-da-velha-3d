// O som do Velha 3D, procedural: nenhum arquivo de áudio, só osciladores. O
// AudioContext é do host (no RoqueOS, o compartilhado com os apps de música;
// fora dele, um próprio), e o jogo só toca quando o contexto já está rodando,
// porque tocar num contexto suspenso enfileira som que sai tudo junto depois.
//
// Frequências, formas de onda e envelopes são os mesmos do componente de antes
// da extração, em 25/09/2026: o jogo tem de soar igual.

/**
 * @param {{ contexto: () => AudioContext | null }} audio a capacidade `audio` do host
 * @param {() => boolean} estaMudo
 */
export function criarSom(audio, estaMudo) {
  let volume = null
  let dono = null

  const contexto = () => {
    if (estaMudo()) return null
    try {
      const c = audio.contexto()
      if (!c || c.state !== 'running') return null
      // O ganho mestre pertence a UM contexto. Se o host trocar de contexto
      // (o iOS fecha o antigo ao voltar do fundo), recria em vez de ligar num
      // nó morto.
      if (dono !== c) {
        volume = c.createGain()
        volume.gain.value = 0.5
        volume.connect(c.destination)
        dono = c
      }
      return c
    } catch {
      return null
    }
  }

  const envelope = (c, t0, pico, queda) => {
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(pico, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + queda)
    g.connect(volume)
    return g
  }

  // Nota MIDI para hertz, com o lá central (69) em 440.
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12)

  return {
    /** Uma marca no cubo (mais aguda a do jogador, mais grave a da IA) e o empate. */
    bip(freq, tipo = 'triangle', pico = 0.12, duracao = 0.12) {
      const c = contexto()
      if (!c) return
      const agora = c.currentTime
      const o = c.createOscillator()
      o.type = tipo
      o.frequency.value = freq
      o.connect(envelope(c, agora, pico, duracao))
      o.start(agora)
      o.stop(agora + duracao + 0.02)
    },
    /** Fim de partida com vencedor: arpejo subindo se o jogador venceu, descendo se a IA venceu. */
    fanfarra(venceu) {
      const c = contexto()
      if (!c) return
      const agora = c.currentTime
      const notas = venceu ? [60, 64, 67, 72, 76] : [67, 63, 58, 53]
      notas.forEach((m, i) => {
        const o = c.createOscillator()
        o.type = venceu ? 'triangle' : 'sawtooth'
        o.frequency.value = hz(m)
        o.connect(envelope(c, agora + i * 0.09, 0.18, 0.4))
        o.start(agora + i * 0.09)
        o.stop(agora + i * 0.09 + 0.42)
      })
    },
  }
}
