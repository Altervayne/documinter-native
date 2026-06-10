import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'

export function UpdatePrompt() {
   const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)

   useEffect(() => {
      if (!('serviceWorker' in navigator)) return

      function handleRegistration(reg: ServiceWorkerRegistration) {
         // Already waiting on mount (e.g. page was reloaded after a new build)
         if (reg.waiting) {
            setWaitingWorker(reg.waiting)
            return
         }

         // New SW found while the page is open
         reg.addEventListener('updatefound', () => {
            const worker = reg.installing
            if (!worker) return
            worker.addEventListener('statechange', () => {
               // "installed" + an existing controller = a new SW is waiting
               if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                  setWaitingWorker(worker)
               }
            })
         })
      }

      // Covers the case where a registration already exists
      navigator.serviceWorker.getRegistration().then(reg => {
         if (reg) handleRegistration(reg)
      })

      // Covers fresh registrations (first ever page load with SW)
      navigator.serviceWorker.addEventListener('message', (event) => {
         if (event.data?.type === 'SW_REGISTERED') {
            navigator.serviceWorker.getRegistration().then(reg => {
               if (reg) handleRegistration(reg)
            })
         }
      })
   }, [])

   if (!waitingWorker) return null

   function handleReload() {
      waitingWorker!.postMessage({ type: 'SKIP_WAITING' })
      navigator.serviceWorker.addEventListener(
         'controllerchange',
         () => window.location.reload(),
         { once: true },
      )
   }

   return (
      <div
         className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-3 px-4 py-2.5 bg-raised border-t border-border"
         style={{ animation: 'sidebar-fadein 200ms ease-out both' }}
      >
         <RefreshCw size={14} className="text-accent shrink-0" />
         <span className="flex-1 text-xs font-mono text-muted">
            A new version of Documinter is available.
         </span>
         <button
            onClick={handleReload}
            className="px-3 py-1 rounded-md bg-accent text-on-accent text-xs font-mono font-semibold cursor-pointer hover:opacity-90 transition-opacity shrink-0"
         >
            Reload to update
         </button>
         <button
            onClick={() => setWaitingWorker(null)}
            title="Dismiss"
            className="p-1 rounded-md text-muted hover:text-text transition-colors cursor-pointer shrink-0"
         >
            <X size={14} />
         </button>
      </div>
   )
}
