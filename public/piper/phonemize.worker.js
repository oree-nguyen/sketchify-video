/* global createPiperPhonemize */
self.onmessage = async (event) => {
  const { text, config, voice, scriptUrl, wasmUrl, dataUrl } = event.data
  try {
    importScripts(scriptUrl)
    const result = await new Promise(async (resolve, reject) => {
      let finished = false
      const module = await createPiperPhonemize({
        print: (line) => {
          if (finished) return
          try {
            const output = JSON.parse(line)
            const phonemes = output.phonemes ?? []
            finished = true
            resolve(config ? { ids: phonemesToIds(phonemes, config) } : { phonemes })
          } catch (error) {
            reject(error)
          }
        },
        printErr: (message) => reject(new Error(String(message))),
        locateFile: (url) => url.endsWith('.wasm') ? wasmUrl : url.endsWith('.data') ? dataUrl : url,
      })
      module.callMain([
        '-l', config?.espeak?.voice ?? voice ?? 'en-us',
        '--input', JSON.stringify([{ text: String(text).trim() }]),
        '--espeak_data', '/espeak-ng-data',
      ])
    })
    self.postMessage(result)
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Không thể xử lý phát âm.' })
  }
}

function phonemesToIds(phonemes, config) {
  const idMap = config.phoneme_id_map
  const ids = [...(idMap['^'] ?? [1])]
  for (const original of phonemes) {
    const mapped = config.phoneme_map?.[original] ?? [original]
    let found = false
    for (const phoneme of mapped) {
      const phonemeIds = idMap[phoneme]
      if (!phonemeIds) continue
      ids.push(...phonemeIds)
      found = true
    }
    if (found) ids.push(...(idMap._ ?? [0]))
  }
  ids.push(...(idMap.$ ?? [2]))
  const invalid = ids.find((id) => !Number.isInteger(id) || id < 0 || id >= config.num_symbols)
  if (invalid !== undefined) throw new Error(`ID phát âm ${invalid} vượt giới hạn model.`)
  return ids
}
