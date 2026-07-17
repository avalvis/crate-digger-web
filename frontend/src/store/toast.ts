import { create } from 'zustand'

interface ToastState {
  message: string | null
  tone: 'default' | 'error' | 'success'
  show: (message: string, tone?: ToastState['tone']) => void
  clear: () => void
}

let timer: number | undefined

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  tone: 'default',
  show: (message, tone = 'default') => {
    if (timer) window.clearTimeout(timer)
    set({ message, tone })
    timer = window.setTimeout(() => set({ message: null }), 4200)
  },
  clear: () => set({ message: null }),
}))

