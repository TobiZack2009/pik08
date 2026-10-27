import { describe, expect, it } from 'vitest'
import { compressedSize, limitUsage, quickStats } from '../../src/ui/stats.js'

describe('stats', () => {
  it('counts tokens and characters', () => {
    expect(quickStats({ code: 'x=1' })).toEqual({ tokens: 3, chars: 3 })
    expect(quickStats({ code: '' })).toEqual({ tokens: 0, chars: 0 })
  })

  it('estimates the compressed size', () => {
    const code = 'for i=1,100 do print(i) end\n'.repeat(20)
    const size = compressedSize(code)
    expect(size).toBeGreaterThan(0)
    expect(size).toBeLessThan(code.length)
  })

  it('reports oversized code as its size instead of throwing', () => {
    const noise = Array.from({ length: 70000 }, (_, i) => String.fromCharCode(33 + ((i * 7919) % 90))).join('')
    expect(() => compressedSize(noise)).not.toThrow()
  })

  it('pairs each limit with its use', () => {
    const limits = { codeChars: 65535, tokens: 8192, compressedBytes: 15616 }
    expect(limitUsage({ tokens: 10, chars: 20 }, limits).map((u) => u.key)).toEqual(['tokens', 'codeChars'])
    expect(limitUsage({ tokens: 10, chars: 20, compressed: 5 }, limits)).toEqual([
      { key: 'tokens', label: 'tokens', value: 10, max: 8192 },
      { key: 'codeChars', label: 'chars', value: 20, max: 65535 },
      { key: 'compressedBytes', label: 'compressed', value: 5, max: 15616 },
    ])
  })
})
