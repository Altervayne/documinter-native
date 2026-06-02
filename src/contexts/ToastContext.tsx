/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type React from 'react'

export type ToastType = 'success' | 'warning' | 'error' | 'neutral'

export interface ToastAction {
   label:   string
   onClick: () => void
}

export interface ToastEntry {
   id:       string
   message:  string
   type:     ToastType
   action?:  ToastAction
   exiting:  boolean
   duration: number
}

export interface ToastOptions {
   type?:     ToastType
   duration?: number
   action?:   ToastAction
}

interface ToastContextValue {
   toasts:                ToastEntry[]
   showToast:             (message: string, options?: ToastOptions) => string
   dismissToast:          (id: string) => void
   dismissTopmostToast:   () => void
   dismissBottommostToast:() => void
   dismissAllToasts:      () => void
}

const ToastContext = createContext<ToastContextValue>(null!)

export function useToast(): ToastContextValue {
   return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
   const [toasts, setToasts] = useState<ToastEntry[]>([])

   // Tracks latest toasts without stale closures in the dismiss helpers
   const toastsRef = useRef<ToastEntry[]>([])
   toastsRef.current = toasts

   // Map of toast id → auto-dismiss timer, plus id+"-remove" → removal timer
   const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

   const markExiting = useCallback((id: string) => {
      const autoTimer = timers.current.get(id)
      if (autoTimer !== undefined) {
         clearTimeout(autoTimer)
         timers.current.delete(id)
      }
      setToasts(current => current.map(toast => toast.id === id ? { ...toast, exiting: true } : toast))
      const removeTimer = setTimeout(() => {
         setToasts(current => current.filter(toast => toast.id !== id))
         timers.current.delete(`${id}-remove`)
      }, 200)
      timers.current.set(`${id}-remove`, removeTimer)
   }, [])

   const showToast = useCallback((message: string, options?: ToastOptions): string => {
      const id       = crypto.randomUUID()
      const type     = options?.type     ?? 'neutral'
      const duration = options?.duration ?? (options?.action ? 6000 : 4000)
      const entry: ToastEntry = { id, message, type, action: options?.action, exiting: false, duration }
      setToasts(current => [...current, entry])
      const timer = setTimeout(() => markExiting(id), duration)
      timers.current.set(id, timer)
      return id
   }, [markExiting])

   const dismissToast = markExiting

   const dismissTopmostToast = useCallback(() => {
      const active = toastsRef.current.filter(toast => !toast.exiting)
      if (active.length > 0) markExiting(active[0].id)
   }, [markExiting])

   const dismissBottommostToast = useCallback(() => {
      const active = toastsRef.current.filter(toast => !toast.exiting)
      if (active.length > 0) markExiting(active[active.length - 1].id)
   }, [markExiting])

   const dismissAllToasts = useCallback(() => {
      toastsRef.current
         .filter(toast => !toast.exiting)
         .forEach(toast => markExiting(toast.id))
   }, [markExiting])

   return (
      <ToastContext.Provider value={{
         toasts,
         showToast,
         dismissToast,
         dismissTopmostToast,
         dismissBottommostToast,
         dismissAllToasts,
      }}>
         {children}
      </ToastContext.Provider>
   )
}
