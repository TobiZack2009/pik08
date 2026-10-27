import './elements.css'
import { P8Button } from './p8-button.js'
import { P8Dialog } from './p8-dialog.js'
import { P8Icon } from './p8-icon.js'
import { P8Meter } from './p8-meter.js'
import { P8Palette } from './p8-palette.js'
import { P8Split } from './p8-split.js'
import { P8Tabs } from './p8-tabs.js'
import { P8Toolbar } from './p8-toolbar.js'

export { showDialog } from './p8-dialog.js'

const ELEMENTS = {
  'p8-button': P8Button,
  'p8-dialog': P8Dialog,
  'p8-icon': P8Icon,
  'p8-meter': P8Meter,
  'p8-palette': P8Palette,
  'p8-split': P8Split,
  'p8-tabs': P8Tabs,
  'p8-toolbar': P8Toolbar,
}

/** Registers the custom elements (safe to call more than once). */
export function defineElements() {
  for (const [name, ctor] of Object.entries(ELEMENTS)) {
    if (!customElements.get(name)) customElements.define(name, ctor)
  }
}

defineElements()
