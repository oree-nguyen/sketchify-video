interface TokenizerJson {
  model: { vocab: Record<string, number>; merges: Array<[string, string]> }
}

const wordPattern = /(?:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/giu

export function createVieNeuTokenizer(json: TokenizerJson): (text: string) => number[] {
  const ranks = new Map(json.model.merges.map((pair, index) => [`${pair[0]}\0${pair[1]}`, index]))
  const byteEncoder = bytesToUnicode()
  return (source: string) => {
    const ids: number[] = []
    for (const match of source.normalize('NFC').matchAll(wordPattern)) {
      const encoded = [...new TextEncoder().encode(match[0])].map((byte) => byteEncoder[byte]).join('')
      for (const token of bpe(encoded, ranks)) ids.push(json.model.vocab[token] ?? 43)
    }
    return ids
  }
}

function bpe(token: string, ranks: Map<string, number>): string[] {
  let parts = [...token]
  while (parts.length > 1) {
    let best = Number.POSITIVE_INFINITY
    let bestIndex = -1
    for (let index = 0; index < parts.length - 1; index++) {
      const rank = ranks.get(`${parts[index]}\0${parts[index + 1]}`)
      if (rank !== undefined && rank < best) { best = rank; bestIndex = index }
    }
    if (bestIndex < 0) break
    parts.splice(bestIndex, 2, parts[bestIndex] + parts[bestIndex + 1])
  }
  return parts
}

function bytesToUnicode(): string[] {
  const values: number[] = []
  for (let value = 33; value <= 126; value++) values.push(value)
  for (let value = 161; value <= 172; value++) values.push(value)
  for (let value = 174; value <= 255; value++) values.push(value)
  const chars = [...values]
  let extra = 0
  for (let byte = 0; byte < 256; byte++) if (!values.includes(byte)) { values.push(byte); chars.push(256 + extra++) }
  const result: string[] = []
  values.forEach((byte, index) => { result[byte] = String.fromCodePoint(chars[index]) })
  return result
}
