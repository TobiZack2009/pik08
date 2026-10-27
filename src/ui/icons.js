import {
  ArrowLeftRight,
  ArrowRightFromLine,
  ArrowUpDown,
  AudioWaveform,
  Ban,
  BoxSelect,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Circle,
  ClipboardPaste,
  Code,
  Copy,
  Download,
  Eraser,
  Eye,
  FilePlus,
  FlipHorizontal,
  FlipVertical,
  Flag,
  FolderOpen,
  Grid3x3,
  Hand,
  Image,
  Info,
  Layers,
  Map,
  Maximize2,
  Minus,
  Moon,
  Move,
  Music,
  OctagonX,
  PaintBucket,
  Palette,
  PanelBottom,
  PanelRight,
  Pencil,
  Pipette,
  Play,
  Plus,
  Redo2,
  Repeat,
  RectangleHorizontal,
  RotateCw,
  Save,
  Scissors,
  Search,
  SkipForward,
  Square,
  Stamp,
  Sun,
  Terminal,
  Trash2,
  TriangleAlert,
  Undo2,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide'

/**
 * Lucide's icon format: a list of `[tag, attributes]` children for a 24x24 `<svg>`.
 * @typedef {[tag: string, attrs: Record<string, string | number | undefined>][]} IconNode
 */

/**
 * Only the icons named here end up in the bundle. Add the import above and an entry here to use a
 * new one.
 * @type {Record<string, IconNode>}
 */
export const ICONS = {
  'arrow-left-right': ArrowLeftRight,
  'arrow-right-from-line': ArrowRightFromLine,
  'arrow-up-down': ArrowUpDown,
  ban: Ban,
  'box-select': BoxSelect,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  circle: Circle,
  'circle-dot': CircleDot,
  code: Code,
  copy: Copy,
  download: Download,
  eraser: Eraser,
  eye: Eye,
  'file-plus': FilePlus,
  flag: Flag,
  'flip-horizontal': FlipHorizontal,
  'flip-vertical': FlipVertical,
  'folder-open': FolderOpen,
  grid: Grid3x3,
  hand: Hand,
  image: Image,
  info: Info,
  layers: Layers,
  map: Map,
  maximize: Maximize2,
  minus: Minus,
  moon: Moon,
  move: Move,
  music: Music,
  'octagon-x': OctagonX,
  'paint-bucket': PaintBucket,
  palette: Palette,
  'panel-bottom': PanelBottom,
  'panel-right': PanelRight,
  paste: ClipboardPaste,
  pencil: Pencil,
  pipette: Pipette,
  play: Play,
  plus: Plus,
  rect: RectangleHorizontal,
  redo: Redo2,
  repeat: Repeat,
  'rotate-cw': RotateCw,
  save: Save,
  scissors: Scissors,
  search: Search,
  'skip-forward': SkipForward,
  stamp: Stamp,
  stop: Square,
  sun: Sun,
  terminal: Terminal,
  trash: Trash2,
  undo: Undo2,
  volume: Volume2,
  waveform: AudioWaveform,
  warning: TriangleAlert,
  x: X,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Builds the `<svg>` for an icon. Unknown names give an empty box rather than an error, so a typo
 * shows up as a missing icon.
 * @param {string} name
 * @returns {SVGSVGElement}
 */
export function svgIcon(name) {
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG_NS, 'svg'))
  const attrs = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v)
  for (const [tag, props] of ICONS[name] ?? []) {
    const child = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(props)) if (v !== undefined) child.setAttribute(k, String(v))
    svg.append(child)
  }
  return svg
}
