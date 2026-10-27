/**
 * A tiny element builder, so UI code reads like the DOM it makes.
 *
 * Props:
 * - `class` (string), `style` (object of CSS properties or custom properties), `dataset` (object)
 * - `onclick`, `oninput`, ... (functions) become event listeners
 * - `.name` sets a property (`'.value': 3`) instead of an attribute
 * - `true` sets an empty attribute, `false`, `null` and `undefined` skip it
 * Children: nodes and strings; `null`, `undefined` and `false` are skipped, arrays are flattened.
 *
 * @template {string} K
 * @param {K} tag
 * @param {Record<string, any> | null} [props]
 * @param {...any} children
 * @returns {K extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[K] : HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') {
      el.className = value
    } else if (key === 'style' && typeof value === 'object') {
      for (const [name, v] of Object.entries(value)) {
        if (name.startsWith('--')) el.style.setProperty(name, String(v))
        else /** @type {any} */ (el.style)[name] = v
      }
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value)
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value)
    } else if (key.startsWith('.')) {
      /** @type {any} */ (el)[key.slice(1)] = value
    } else {
      el.setAttribute(key, value === true ? '' : String(value))
    }
  }
  append(el, children)
  return /** @type {any} */ (el)
}

/**
 * @param {Element} parent
 * @param {any[]} children
 */
function append(parent, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue
    if (Array.isArray(child)) append(parent, child)
    else parent.append(child instanceof Node ? child : String(child))
  }
}

/**
 * Replaces all children of an element.
 * @param {Element} parent
 * @param {...any} children
 */
export function replaceChildren(parent, ...children) {
  parent.replaceChildren()
  append(parent, children)
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
