import type { ToastEntry } from '../contexts/ToastContext'

// Left-border color per toast type
const TYPE_COLORS: Record<ToastEntry['type'], string> = {
   neutral: 'var(--color-accent)',
   success: '#22c55e',
   warning: '#f59e0b',
   error:   '#f43f5e',
}

interface ToastProps {
   toast:     ToastEntry
   onDismiss: (id: string) => void
}

export function Toast({ toast, onDismiss }: ToastProps) {
   return (
      <div
         className={[
            'flex items-center gap-3 min-w-64 max-w-80',
            'bg-raised border border-border rounded-lg shadow-xl',
            'pl-3 pr-3 py-2.5 text-sm',
            'transition-all duration-200 ease-out',
            toast.exiting
               ? 'opacity-0 translate-x-3 pointer-events-none'
               : 'opacity-100 translate-x-0',
         ].join(' ')}
         style={{ borderLeft: `3px solid ${TYPE_COLORS[toast.type]}` }}
      >
         <span className="flex-1 text-text text-xs font-medium leading-snug">{toast.message}</span>

         {toast.action && (
            <button
               onClick={() => { toast.action!.onClick(); onDismiss(toast.id) }}
               className="shrink-0 text-accent border border-accent/40 rounded px-2.5 py-0.5 text-xs font-medium hover:bg-accent/10 transition-colors cursor-pointer"
            >
               {toast.action.label}
            </button>
         )}

         <button
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 text-muted/50 hover:text-muted transition-colors cursor-pointer text-base leading-none"
            aria-label="Dismiss"
         >
            ×
         </button>
      </div>
   )
}
