import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImage, generateSpeech, generateStoryScript, PollinationsError } from './pollinationsClient'

afterEach(() => vi.restoreAllMocks())

describe('Pollinations client contract', () => {
  it('gửi Bearer key và chuẩn hoá StoryScript theo đúng field', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '```json\n{"scenes":[{"order":8,"narrationText":" Lời đọc ","imagePrompt":" Nền trắng "}]}\n```' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const script = await generateStoryScript('sk_test', { topic: 'Nước', targetSceneCount: 1, language: 'vi' })
    expect(script).toEqual({ scenes: [{ order: 1, narrationText: 'Lời đọc', imagePrompt: 'Nền trắng' }] })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer sk_test')
  })

  it('đổi ảnh base64 thành Blob và nhận audio nhị phân', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: btoa('png') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }))
    expect((await generateImage('sk_test', 'ảnh')).type).toBe('image/png')
    const audio = await generateSpeech('sk_test', 'xin chào')
    expect(audio.type).toBe('audio/mpeg')
    expect(audio.size).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('biến lỗi ngân sách thành thông báo hành động rõ ràng', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 402 }))
    await expect(generateSpeech('sk_test', 'xin chào')).rejects.toMatchObject({ status: 402 } satisfies Partial<PollinationsError>)
    await expect(generateSpeech('sk_test', 'xin chào')).rejects.toThrow(/không đủ Pollen/)
  })
})
