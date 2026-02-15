/**
 * Celebration Effect (Confetti + Fireworks + Sound)
 * Extracted to standalone module to avoid react-refresh/only-export-components warning
 */

/** Play firework sound effect */
function playCelebrationSound() {
  try {
    const audio = new Audio('/cheer.mp3')
    audio.volume = 0.4
    audio.play().catch(e => console.warn('Failed to play firework sound:', e))
  } catch (e) {
    console.warn('Failed to create firework sound:', e)
  }
}

export function triggerCelebration() {
  playCelebrationSound()
  const colors = ['#ff0', '#f0f', '#0ff', '#f00', '#0f0', '#00f', '#ff8800', '#ff0088', '#ff4444', '#44ff44', '#4444ff', '#ffaa00']
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:99999;overflow:hidden'
  document.body.appendChild(container)

  // ── Confetti (300 pieces, multiple shapes) ──
  const shapes = ['rect', 'circle', 'strip']
  for (let i = 0; i < 300; i++) {
    const confetti = document.createElement('div')
    const shape = shapes[Math.floor(Math.random() * shapes.length)]
    const color = colors[Math.floor(Math.random() * colors.length)]
    const left = Math.random() * 100
    const delay = Math.random() * 3
    const duration = Math.random() * 3 + 3
    const rotation = Math.random() * 360
    const swayClass = `confetti-fall-${Math.floor(Math.random() * 3)}`

    let shapeStyle = ''
    if (shape === 'rect') {
      const size = Math.random() * 10 + 5
      shapeStyle = `width:${size}px;height:${size * 0.6}px;border-radius:2px;`
    } else if (shape === 'circle') {
      const size = Math.random() * 8 + 4
      shapeStyle = `width:${size}px;height:${size}px;border-radius:50%;`
    } else {
      shapeStyle = `width:${Math.random() * 3 + 2}px;height:${Math.random() * 15 + 10}px;border-radius:1px;`
    }

    confetti.style.cssText = `
      position:absolute;left:${left}%;top:-20px;
      background:${color};opacity:0.9;
      transform:rotate(${rotation}deg);
      animation:${swayClass} ${duration}s ease-in ${delay}s forwards;
      ${shapeStyle}
    `
    container.appendChild(confetti)
  }

  // ── Fireworks (3 bursts) ──
  const fireworkPositions = [
    { x: 30, y: 30 }, { x: 50, y: 25 }, { x: 70, y: 35 },
  ]
  fireworkPositions.forEach((pos, burstIndex) => {
    const burstDelay = burstIndex * 0.8
    for (let i = 0; i < 40; i++) {
      const particle = document.createElement('div')
      const color = colors[Math.floor(Math.random() * colors.length)]
      const angle = (Math.PI * 2 * i) / 40 + (Math.random() - 0.5) * 0.3
      const distance = Math.random() * 120 + 60
      const tx = Math.cos(angle) * distance
      const ty = Math.sin(angle) * distance
      const size = Math.random() * 4 + 2

      particle.style.cssText = `
        position:absolute;left:${pos.x}%;top:${pos.y}%;
        width:${size}px;height:${size}px;border-radius:50%;
        background:${color};opacity:0;
        animation:firework-burst ${1.2 + Math.random() * 0.5}s ease-out ${burstDelay + 0.5}s forwards;
        --tx:${tx}px;--ty:${ty}px;
      `
      container.appendChild(particle)
    }
  })

  // Inject keyframes if not already present
  if (!document.getElementById('celebration-keyframes')) {
    const style = document.createElement('style')
    style.id = 'celebration-keyframes'
    style.textContent = `
      @keyframes confetti-fall-0 {
        0% { top: -20px; opacity: 1; transform: rotate(0deg) translateX(0); }
        25% { opacity: 1; transform: rotate(180deg) translateX(30px); }
        50% { opacity: 0.8; transform: rotate(360deg) translateX(-20px); }
        100% { top: 110vh; opacity: 0; transform: rotate(720deg) translateX(40px); }
      }
      @keyframes confetti-fall-1 {
        0% { top: -20px; opacity: 1; transform: rotate(0deg) translateX(0); }
        25% { opacity: 1; transform: rotate(-120deg) translateX(-35px); }
        50% { opacity: 0.8; transform: rotate(-240deg) translateX(25px); }
        100% { top: 110vh; opacity: 0; transform: rotate(-600deg) translateX(-30px); }
      }
      @keyframes confetti-fall-2 {
        0% { top: -20px; opacity: 1; transform: rotate(0deg) translateX(0); }
        30% { opacity: 1; transform: rotate(90deg) translateX(15px); }
        60% { opacity: 0.8; transform: rotate(270deg) translateX(-15px); }
        100% { top: 110vh; opacity: 0; transform: rotate(540deg) translateX(20px); }
      }
      @keyframes firework-burst {
        0% { opacity: 1; transform: translate(0, 0) scale(1); }
        20% { opacity: 1; transform: translate(calc(var(--tx) * 0.5), calc(var(--ty) * 0.5)) scale(1.2); }
        100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.3); }
      }
    `
    document.head.appendChild(style)
  }

  // Clean up after animation
  setTimeout(() => container.remove(), 8000)
}
