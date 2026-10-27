/**
 * Turning palette-indexed frames into pixels. The editor's preview and the run tab both use this.
 */

/**
 * Converts palette indices to RGBA bytes.
 * @param {ArrayLike<number>} indices  one palette index per pixel
 * @param {readonly number[]} palette  `0xRRGGBB` per index
 * @param {Uint8ClampedArray} [out]  reused if big enough
 * @returns {Uint8ClampedArray}
 */
export function indexedToRgba(indices, palette, out = new Uint8ClampedArray(indices.length * 4)) {
  for (let i = 0; i < indices.length; i++) {
    const rgb = palette[indices[i]] ?? 0
    out[i * 4] = rgb >> 16
    out[i * 4 + 1] = (rgb >> 8) & 255
    out[i * 4 + 2] = rgb & 255
    out[i * 4 + 3] = 255
  }
  return out
}

/**
 * Draws an indexed image onto a canvas of the same size.
 * @param {HTMLCanvasElement} canvas
 * @param {ArrayLike<number>} indices  `canvas.width * canvas.height` entries
 * @param {readonly number[]} palette
 */
export function paintIndexed(canvas, indices, palette) {
  paintIndexedRegion(canvas, indices, palette, 0, 0, canvas.width, canvas.height)
}

/**
 * Draws an indexed image of `w` x `h` pixels with its corner at (x, y), leaving the rest alone.
 * @param {HTMLCanvasElement} canvas
 * @param {ArrayLike<number>} indices  `w * h` entries
 * @param {readonly number[]} palette
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
export function paintIndexedRegion(canvas, indices, palette, x, y, w, h) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const image = ctx.createImageData(w, h)
  indexedToRgba(indices, palette, image.data)
  ctx.putImageData(image, x, y)
}
