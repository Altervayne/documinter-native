import { useEffect, useState } from 'react'

interface ToastAction {
   label: string
   onClick: () => void
}

interface ToastProps {
   message: string
   action?: ToastAction
   onDone: () => void
}

export function Toast({ message, action, onDone }: ToastProps) {
   const [visible, setVisible] = useState(false)

   useEffect(() => {
      if (!message) return
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true)
      const duration = action ? 2500 : 2000
      const t = setTimeout(() => {
         setVisible(false)
         setTimeout(onDone, 200)
      }, duration)
      return () => clearTimeout(t)
   }, [message]) // eslint-disable-line react-hooks/exhaustive-deps

   if (!message) return null

   return (
      <div
         className={[
            'fixed bottom-6 left-1/2 -translate-x-1/2 z-999',
            'bg-raised border border-border rounded',
            'font-mono text-sm text-green px-5 py-3',
            'flex items-center gap-4 shadow-lg',
            'transition-opacity duration-200',
            visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
         ].join(' ')}
      >
         <span>{message}</span>
         {action && (
            <button
               onClick={() => { setVisible(false); action.onClick() }}
               className="text-accent border border-accent/40 rounded px-3 py-1 text-xs font-medium hover:bg-accent/10 transition-colors cursor-pointer"
            >
               {action.label}
            </button>
         )}
      </div>
   )
}
