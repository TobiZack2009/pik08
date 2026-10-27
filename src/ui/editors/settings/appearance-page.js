import { h } from '../../dom.js'
import { DENSITIES, THEMES } from '../../theme.js'
import { row, section } from './rows.js'

/** @import { SettingsApi } from './settings-editor.js' */
/** @import { Prefs } from '../../theme.js' */

/** @param {string} word */
const capitalize = (word) => word[0].toUpperCase() + word.slice(1)

/**
 * One choice out of a few, as radio buttons.
 * @template {'theme' | 'density'} K
 * @param {SettingsApi} settings
 * @param {K} key  the preference
 * @param {string} label
 * @param {readonly Prefs[K][]} values
 */
function choice(settings, key, label, values) {
  return h(
    'div',
    { class: 'settings__choice', role: 'radiogroup', 'aria-label': label },
    values.map((value) =>
      h(
        'label',
        { class: 'settings__option' },
        h('input', {
          type: 'radio',
          name: key,
          value,
          '.checked': settings.prefs()[key] === value,
          onchange: () => settings.setPrefs({ [key]: value }),
        }),
        h('span', null, capitalize(value)),
      ),
    ),
  )
}

/**
 * The Appearance category: how the editor looks.
 * @param {SettingsApi} settings
 */
export function appearancePage(settings) {
  return {
    el: section(
      'Appearance',
      row('Theme', 'Dark or light colours for the whole editor', choice(settings, 'theme', 'Theme', THEMES)),
      row('Density', 'Compact makes rows and spacing smaller, to fit more on screen', choice(settings, 'density', 'Density', DENSITIES)),
    ),
  }
}
