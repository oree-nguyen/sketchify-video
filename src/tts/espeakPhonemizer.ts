/// <reference lib="webworker" />

export async function phonemizeWithEspeak(text: string, voice: string, baseUrl: string): Promise<string[]> {
  const worker = new Worker(`${baseUrl}piper/phonemize.worker.js`)
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const timeout = self.setTimeout(() => reject(new Error('Bộ xử lý phát âm không phản hồi.')), 30_000)
      worker.onmessage = (event: MessageEvent<{ phonemes?: string[]; error?: string }>) => {
        self.clearTimeout(timeout)
        if (event.data.error) reject(new Error(event.data.error))
        else resolve(event.data.phonemes ?? [])
      }
      worker.onerror = () => {
        self.clearTimeout(timeout)
        reject(new Error('Không khởi động được bộ xử lý phát âm.'))
      }
      worker.postMessage({
        text,
        voice,
        scriptUrl: `${baseUrl}piper/piper_phonemize.js`,
        wasmUrl: `${baseUrl}piper/piper_phonemize.wasm`,
        dataUrl: `${baseUrl}piper/piper_phonemize.data`,
      })
    })
  } finally {
    worker.terminate()
  }
}
