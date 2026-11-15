// Builds the backdrop: a vertical gradient from purple through red to orange, with radial dithered glows and diamonds drifting over it.
//
// Motion is CSS transforms on plain groups: surfaces strip SVG <animate>, and a
// live window does not repaint a clip path that moves on its own.

// The base gradient's colors, dark enough to sit under text.
export const COLORS = ['#26123d', '#3a0f1a', '#3b1c0b'] as const
// The drifting glows, a step brighter, and a near-black for depth.
const GLOWS = ['#3e1d66', '#5c1729', '#5e2d11'] as const
const VOID = '#0b0610'
// Lighter twins for the sparse twinkle layer.
const SPARKS = ['#4a2775', '#6b1c2c', '#6e3615'] as const

const PALETTE = [...COLORS, ...GLOWS, VOID]
const GLOW = (i: number) => COLORS.length + i
const VOID_INDEX = PALETTE.length - 1

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

const PX = 2 // one dither pixel, in viewBox units
const TILE = PX * 4
const SIZE = 960 // the square viewBox, cropped to fit any screen
const LEVELS = 16 // dither levels per color step
const BAND = 30 // height of one level's band
const STEP = LEVELS * BAND // one color step
// Dither level of each ring of a shape, from its edge inward: small steps so the
// falloff reads as a gradient. The near-black shapes stay lighter.
const RINGS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12]
const VOID_RINGS = [1, 2, 3, 4, 5, 6]
const EASE = '0.45 0 0.55 1'

type Shape = {
  kind: 'glow' | 'diamond'
  color: number
  size: number
  x: number
  y: number
  wander: number // how far it roams from (x, y)
  seconds: number // one loop of its path
  seed: number
}

const SHAPES: Shape[] = [
  { kind: 'glow', color: GLOW(0), size: 270, x: 300, y: 330, wander: 140, seconds: 110, seed: 1 },
  { kind: 'glow', color: GLOW(2), size: 310, x: 680, y: 690, wander: 150, seconds: 140, seed: 2 },
  { kind: 'glow', color: GLOW(1), size: 230, x: 630, y: 260, wander: 120, seconds: 95, seed: 3 },
  { kind: 'glow', color: VOID_INDEX, size: 250, x: 250, y: 700, wander: 140, seconds: 160, seed: 4 },
  { kind: 'glow', color: GLOW(0), size: 160, x: 160, y: 560, wander: 90, seconds: 80, seed: 5 },
  { kind: 'diamond', color: GLOW(0), size: 190, x: 770, y: 470, wander: 110, seconds: 125, seed: 6 },
  { kind: 'diamond', color: GLOW(2), size: 150, x: 230, y: 770, wander: 100, seconds: 105, seed: 7 },
  { kind: 'diamond', color: GLOW(1), size: 130, x: 480, y: 170, wander: 120, seconds: 135, seed: 8 },
  { kind: 'diamond', color: VOID_INDEX, size: 140, x: 760, y: 180, wander: 120, seconds: 150, seed: 9 },
]

// The pixels of a 4x4 tile lit at a given level, as one path.
const levelPath = (level: number): string =>
  BAYER.flatMap((row, y) =>
    row.flatMap((v, x) => (v < level ? [`M${x * PX} ${y * PX}h${PX}v${PX}h-${PX}z`] : [])),
  ).join('')

const fill = (color: number, level: number) => `url(#p${color}_${level})`

const round = (n: number) => Math.round(n)

// A looping path of five waypoints (the last is the first).
const waypoints = ({ x, y, wander, seed }: Shape) => {
  const points = [0, 1, 2, 3].map(i => {
    const angle = (i * Math.PI) / 2 + seed * 0.9
    const reach = wander * (0.55 + 0.45 * (((i * 37 + seed * 11) % 7) / 6))
    return {
      x: x + Math.cos(angle) * reach,
      y: y + Math.sin(angle) * reach * 0.8,
    }
  })
  return [...points, points[0]!]
}

const diamondPoints = (x: number, y: number, r: number) =>
  `${round(x)},${round(y - r)} ${round(x + r * 0.8)},${round(y)} ${round(x)},${round(y + r)} ${round(x - r * 0.8)},${round(y)}`

// The CSS that walks a shape along its waypoints, eased between each. Only a
// translation: a scale would stretch the dither pixels.
const motion = (shape: Shape, s: number): string => {
  const path = waypoints(shape)
  const frames = path
    .map((p, i) => `${(i / (path.length - 1)) * 100}%{transform:translate(${round(p.x)}px,${round(p.y)}px)}`)
    .join('')
  const delay = (shape.seed * 17) % shape.seconds
  return `@keyframes m${s}{${frames}}.m${s}{animation:m${s} ${shape.seconds}s cubic-bezier(${EASE.replaceAll(' ', ',')}) -${delay}s infinite}`
}

// A shape is its rings stacked from the edge in, each denser than the last, so
// it reads as a radial dithered gradient into whatever lies under it. The whole
// group moves, its dither with it. The start transform draws it in place where
// CSS animation can't run.
const drawShape = (shape: Shape, s: number): string => {
  const start = waypoints(shape)[0]!
  const rings = shape.color === VOID_INDEX ? VOID_RINGS : RINGS
  const body = rings
    .map((level, i) => {
      const r = shape.size * (1 - (i / rings.length) * 0.8)
      const paint = `fill="${fill(shape.color, level)}"`
      return shape.kind === 'glow'
        ? `<circle r="${round(r)}" ${paint}/>`
        : `<polygon points="${diamondPoints(0, 0, r)}" ${paint}/>`
    })
    .join('')
  return `<g class="m${s}" transform="translate(${round(start.x)} ${round(start.y)})">${body}</g>`
}

export const buildScene = (): string => {
  const defs: string[] = []
  for (let level = 1; level < LEVELS; level++) {
    defs.push(`<path id="l${level}" d="${levelPath(level)}"/>`)
    PALETTE.forEach((color, c) => {
      defs.push(
        `<pattern id="p${c}_${level}" width="${TILE}" height="${TILE}" patternUnits="userSpaceOnUse"><use href="#l${level}" fill="${color}"/></pattern>`,
      )
    })
  }

  // Sparse twinkle tiles: one lit pixel per 12x12 cells, offset per color.
  const sparkTile = PX * 12
  SPARKS.forEach((color, c) => {
    const x = ((c * 5) % 12) * PX
    const y = ((c * 7 + 3) % 12) * PX
    defs.push(
      `<pattern id="s${c}" width="${sparkTile}" height="${sparkTile}" patternUnits="userSpaceOnUse"><rect x="${x}" y="${y}" width="${PX}" height="${PX}" fill="${color}"/></pattern>`,
    )
  })

  // The base gradient stays still; the shapes over it move.
  const bands: string[] = []
  COLORS.forEach((from, c) => {
    const to = (c + 1) % COLORS.length
    const top = c * STEP - STEP / 4
    bands.push(`<rect y="${top}" width="${SIZE}" height="${STEP}" fill="${from}"/>`)
    for (let level = 1; level < LEVELS; level++) {
      bands.push(`<rect y="${top + level * BAND}" width="${SIZE}" height="${BAND}" fill="${fill(to, level)}"/>`)
    }
  })

  const style = [
    ...SHAPES.map(motion),
    '.spark{animation:twinkle 11s ease-in-out infinite}',
    '.spark.b{animation-delay:-3.7s}.spark.c{animation-delay:-7.3s}',
    '@keyframes twinkle{0%,100%{opacity:0}50%{opacity:.45}}',
    '@media (prefers-reduced-motion:reduce){*{animation:none!important}}',
  ].join('')

  const sparks = ['a', 'b', 'c']
    .map((cls, c) => `<rect class="spark ${cls}" opacity="0" width="${SIZE}" height="${SIZE}" fill="url(#s${c})"/>`)
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges">` +
    `<style>${style}</style><defs>${defs.join('')}</defs>` +
    `<rect width="${SIZE}" height="${SIZE}" fill="${COLORS[0]}"/>` +
    bands.join('') +
    SHAPES.map(drawShape).join('') +
    `${sparks}</svg>`
  )
}
