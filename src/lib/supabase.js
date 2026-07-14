import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabasePublishableKey) : null

export function clearSupabaseSessionStorage() {
  if (!isSupabaseConfigured || typeof window === 'undefined') return
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  const keyPrefix = `sb-${projectRef}-`
  for (const storage of [window.localStorage, window.sessionStorage]) {
    Object.keys(storage).filter((key) => key.startsWith(keyPrefix)).forEach((key) => storage.removeItem(key))
  }
}
