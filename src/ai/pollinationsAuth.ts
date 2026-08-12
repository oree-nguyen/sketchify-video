const ACCESS_KEY_STORAGE = 'wb.pollinations.key'
const APP_KEY_STORAGE = 'wb.pollinations.app-key'
const AUTH_STATE_STORAGE = 'wb.pollinations.auth-state'

export function getPollinationsAccessKey(): string | null {
  const value = localStorage.getItem(ACCESS_KEY_STORAGE)
  return value?.startsWith('sk_') ? value : null
}

export function getPollinationsAppKey(): string | null {
  const configured = import.meta.env.VITE_POLLINATIONS_APP_KEY?.trim()
  if (configured?.startsWith('pk_')) return configured
  const stored = localStorage.getItem(APP_KEY_STORAGE)
  return stored?.startsWith('pk_') ? stored : null
}

export function savePollinationsAppKey(value: string): void {
  const normalized = value.trim()
  if (!normalized.startsWith('pk_')) throw new Error('App Key Pollinations phải bắt đầu bằng pk_.')
  localStorage.setItem(APP_KEY_STORAGE, normalized)
}

export function disconnectPollinations(): void {
  localStorage.removeItem(ACCESS_KEY_STORAGE)
}

export function beginPollinationsAuth(appKey: string): void {
  if (!appKey.startsWith('pk_')) throw new Error('Chưa cấu hình App Key Pollinations hợp lệ.')
  const stateBytes = crypto.getRandomValues(new Uint8Array(24))
  const state = Array.from(stateBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  sessionStorage.setItem(AUTH_STATE_STORAGE, state)
  const callback = new URL('auth/callback/', document.baseURI).href
  const params = new URLSearchParams({
    client_id: appKey,
    redirect_uri: callback,
    scope: 'usage',
    state,
    budget: '10',
    expiry: '7',
  })
  location.assign(`https://enter.pollinations.ai/authorize?${params}`)
}

export function consumeAuthCallbackResult(): 'connected' | 'denied' | null {
  const result = sessionStorage.getItem('wb.pollinations.callback-result')
  if (!result) return null
  sessionStorage.removeItem('wb.pollinations.callback-result')
  return result === 'connected' ? 'connected' : 'denied'
}

export const POLLINATIONS_AUTH_STATE_STORAGE = AUTH_STATE_STORAGE
export const POLLINATIONS_ACCESS_KEY_STORAGE = ACCESS_KEY_STORAGE
