import { useEffect } from 'react'
import { create } from 'zustand'

interface ToastStore {
  msg: string | null
  show: (msg: string) => void
  clear: () => void
}

const useToastStore = create<ToastStore>((set) => ({
  msg: null,
  show: (msg) => set({ msg }),
  clear: () => set({ msg: null }),
}))

export function toast(msg: string): void {
  useToastStore.getState().show(msg)
}

export function ToastHost() {
  const msg = useToastStore((s) => s.msg)
  const clear = useToastStore((s) => s.clear)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(clear, 2000)
    return () => clearTimeout(t)
  }, [msg, clear])
  if (!msg) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit max-w-[440px] rounded-doc border border-rule bg-surface px-4 py-2.5 text-[13px] text-ink"
    >
      {msg}
    </div>
  )
}
