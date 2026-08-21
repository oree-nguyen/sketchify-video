import type { InferenceSession, Tensor } from 'onnxruntime-web'

export type ExecutionProvider = 'webgpu' | 'wasm'

export interface RuntimeSession {
  session: InferenceSession
  provider: ExecutionProvider
}

export async function createRuntimeSession(model: Uint8Array): Promise<RuntimeSession> {
  const ort = await import('onnxruntime-web')
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  const providers: ExecutionProvider[] = webgpu ? ['webgpu', 'wasm'] : ['wasm']
  let lastError: unknown
  for (const provider of providers) {
    try {
      const session = await ort.InferenceSession.create(model, { executionProviders: [provider] })
      return { session, provider }
    } catch (error) { lastError = error }
  }
  throw new Error(`ONNX Runtime Web không tạo được session: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

export type RuntimeTensor = Tensor
