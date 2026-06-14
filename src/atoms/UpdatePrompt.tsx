import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { useLang } from '../contexts/LangContext'

export function UpdatePrompt() {
   const { t } = useLang()
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
         className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-xl flex items-center gap-3.5 px-5 py-4 rounded-xl bg-raised border border-border shadow-2xl"
         style={{ animation: 'sidebar-fadein 200ms ease-out both' }}
      >
         <Sparkles size={20} className="text-accent shrink-0" />
         <span className="flex-1 text-sm font-medium text-text">
            {t.updateAvailable}
         </span>
         <button
            onClick={handleReload}
            className="px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold cursor-pointer hover:opacity-90 transition-opacity shrink-0"
         >
            {t.updateReload}
         </button>
         <button
            onClick={() => setWaitingWorker(null)}
            title={t.updateDismiss}
            aria-label={t.updateDismiss}
            className="p-1.5 rounded-md text-muted hover:text-text transition-colors cursor-pointer shrink-0"
         >
            <X size={16} />
         </button>
      </div>
   )
}
