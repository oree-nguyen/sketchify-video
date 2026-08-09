type AnalyzeMessage = { id: number; rgba: Uint8Array; width: number; height: number; settings: Record<string, number> }
let ready: Promise<void> | null = null

self.onmessage = async (event: MessageEvent<AnalyzeMessage | { type: 'init'; execUrl: string; wasmUrl: string }>) => {
  if ('type' in event.data) {
    const { execUrl, wasmUrl } = event.data
    ready = (async () => {
      ;(self as unknown as { importScripts: (...urls: string[]) => void }).importScripts(execUrl)
      const go = new (self as unknown as { Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> } }).Go()
      const result = await WebAssembly.instantiateStreaming(fetch(wasmUrl), go.importObject)
      void go.run(result.instance)
      await new Promise<void>((resolve) => { const test = () => { if ((self as unknown as { wbImaging?: unknown }).wbImaging) resolve(); else setTimeout(test, 10) }; test() })
    })()
    await ready
    self.postMessage({ type: 'ready' })
    return
  }
  await ready
  const { id, rgba, width, height, settings } = event.data
  const api = (self as unknown as { wbImaging: { analyze(data: Uint8Array, width: number, height: number, settings: Record<string, number>): unknown } }).wbImaging
  const result = api.analyze(rgba, width, height, settings)
  self.postMessage({ id, result })
}
