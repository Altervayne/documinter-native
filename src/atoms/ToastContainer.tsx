import { Toast } from './Toast'
import { useToast } from '../contexts/ToastContext'

export function ToastContainer() {
   const { toasts, dismissToast } = useToast()
   if (toasts.length === 0) return null

   return (
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
         {toasts.map(toast => (
            <div key={toast.id} className="pointer-events-auto">
               <Toast toast={toast} onDismiss={dismissToast} />
            </div>
         ))}
      </div>
   )
}
