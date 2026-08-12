import type { StoryModeRequest, StoryScript } from './types'

const API_ROOT = 'https://gen.pollinations.ai'
const RETRYABLE = new Set([429, 502, 503, 504])

export class PollinationsError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

async function requestWithRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, init)
      if (response.ok) return response
      const detail = await response.text().catch(() => '')
      if (!RETRYABLE.has(response.status) || attempt === attempts - 1) {
        throw new PollinationsError(apiMessage(response.status, detail), response.status)
      }
      const retryAfter = Number(response.headers.get('Retry-After'))
      await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 700 * 2 ** attempt)
    } catch (error) {
      lastError = error
      if (error instanceof PollinationsError || attempt === attempts - 1) throw error
      await delay(700 * 2 ** attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Không thể kết nối Pollinations.')
}

function apiMessage(status: number, detail: string): string {
  if (status === 401) return 'Phiên Pollinations không hợp lệ hoặc đã hết hạn. Hãy kết nối lại.'
  if (status === 402) return 'Tài khoản Pollinations không đủ Pollen hoặc đã chạm ngân sách.'
  if (status === 429) return 'Pollinations đang giới hạn tốc độ. Hãy thử lại sau.'
  return `Pollinations trả lỗi ${status}${detail ? `: ${detail.slice(0, 180)}` : ''}`
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function authHeaders(accessKey: string, json = false): HeadersInit {
  return { Authorization: `Bearer ${accessKey}`, ...(json ? { 'Content-Type': 'application/json' } : {}) }
}

export async function generateStoryScript(accessKey: string, request: StoryModeRequest): Promise<StoryScript> {
  const countInstruction = request.targetSceneCount ? `Tạo đúng ${request.targetSceneCount} cảnh.` : 'Tự chọn 4 đến 7 cảnh phù hợp.'
  const response = await requestWithRetry(`${API_ROOT}/v1/chat/completions`, {
    method: 'POST', headers: authHeaders(accessKey, true),
    body: JSON.stringify({
      model: 'openai', temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Bạn viết storyboard video whiteboard tiếng Việt. Chỉ trả JSON hợp lệ dạng {"scenes":[{"order":1,"narrationText":"...","imagePrompt":"..."}]}. imagePrompt mô tả ảnh nền trắng, vật thể tách biệt, không chữ, phù hợp tách khối.' },
        { role: 'user', content: `${countInstruction}\nChủ đề: ${request.topic}` },
      ],
    }),
  })
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('Pollinations không trả về kịch bản.')
  return validateStoryScript(parseJsonObject(content))
}

export async function generateImage(accessKey: string, prompt: string): Promise<Blob> {
  const response = await requestWithRetry(`${API_ROOT}/v1/images/generations`, {
    method: 'POST', headers: authHeaders(accessKey, true),
    body: JSON.stringify({ model: 'flux', prompt, size: '1024x1024', quality: 'medium', response_format: 'b64_json', n: 1, safe: true }),
  })
  const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
  const item = payload.data?.[0]
  if (item?.b64_json) return base64ToBlob(item.b64_json, 'image/png')
  if (item?.url) return (await requestWithRetry(item.url, { method: 'GET' })).blob()
  throw new Error('Pollinations không trả về dữ liệu ảnh.')
}

export async function generateSpeech(accessKey: string, text: string): Promise<Blob> {
  const response = await requestWithRetry(`${API_ROOT}/v1/audio/speech`, {
    method: 'POST', headers: authHeaders(accessKey, true),
    body: JSON.stringify({ input: text, voice: 'nova', response_format: 'mp3' }),
  })
  return response.blob()
}

function parseJsonObject(content: string): unknown {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(clean) } catch { throw new Error('Kịch bản AI không phải JSON hợp lệ. Hãy thử tạo lại.') }
}

function validateStoryScript(value: unknown): StoryScript {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { scenes?: unknown }).scenes)) throw new Error('Kịch bản AI thiếu danh sách scenes.')
  const scenes = (value as { scenes: unknown[] }).scenes.map((scene, index) => {
    if (!scene || typeof scene !== 'object') throw new Error(`Cảnh ${index + 1} không hợp lệ.`)
    const item = scene as Record<string, unknown>
    if (typeof item.narrationText !== 'string' || typeof item.imagePrompt !== 'string' || !item.narrationText.trim() || !item.imagePrompt.trim()) throw new Error(`Cảnh ${index + 1} thiếu lời đọc hoặc prompt ảnh.`)
    return { order: index + 1, narrationText: item.narrationText.trim(), imagePrompt: item.imagePrompt.trim() }
  })
  if (!scenes.length || scenes.length > 20) throw new Error('Kịch bản phải có từ 1 đến 20 cảnh.')
  return { scenes }
}

function base64ToBlob(value: string, contentType: string): Blob {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  return new Blob([bytes], { type: contentType })
}
