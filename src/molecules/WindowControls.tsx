/*
 * Native window caption buttons (Windows layout: minimize / maximize-restore / close, flush to the
 * top-right corner). Rendered only inside the Tauri shell, where the OS title bar is turned off and
 * HeaderMenuBar stands in for it. Each button drives the current window through the Tauri API; the
 * maximize glyph tracks the real window state so it flips to a restore glyph while maximized.
 */

// -- React Imports --
import { useEffect, useState } from 'react'

// -- Library Imports --
import { getCurrentWindow } from '@tauri-apps/api/window'

// -- Icon Imports --
import { Minus, Square, Copy, X } from 'lucide-react'

// -- Context Imports --
import { useLang } from '../contexts/LangContext'

export function WindowControls() {
   const { t } = useLang()
   const [maximized, setMaximized] = useState(false)

   // Keep the maximize/restore glyph in sync with the real window. onResized fires on maximize,
   // restore and manual resize alike, so re-reading isMaximized there covers every transition.
   useEffect(() => {
      const appWindow = getCurrentWindow()
      let unlisten: (() => void) | undefined
      let active = true

      appWindow.isMaximized().then((value) => { if (active) setMaximized(value) })
      appWindow.onResized(() => {
         appWindow.isMaximized().then((value) => { if (active) setMaximized(value) })
      }).then((stop) => {
         if (active) unlisten = stop
         else stop()
      })

      return () => {
         active = false
         unlisten?.()
      }
   }, [])

   function handleMinimize() {
      getCurrentWindow().minimize()
   }

   function handleToggleMaximize() {
      getCurrentWindow().toggleMaximize()
   }

   function handleClose() {
      getCurrentWindow().close()
   }

   // Flush to the top-right corner: negative margins cancel the header's own padding so the row
   // reaches the window edge like real caption buttons. A left divider separates it from the app
   // cluster. Not a drag region, these are interactive controls.
   return (
      <div className="flex items-stretch self-stretch -my-1 -mr-3 ml-1 border-l border-border">
         <button
            type="button"
            onClick={handleMinimize}
            title={t.windowMinimize}
            aria-label={t.windowMinimize}
            className="flex w-[46px] items-center justify-center text-muted transition-colors hover:bg-el hover:text-text cursor-pointer"
         >
            <Minus size={16} />
         </button>
         <button
            type="button"
            onClick={handleToggleMaximize}
            title={maximized ? t.windowRestore : t.windowMaximize}
            aria-label={maximized ? t.windowRestore : t.windowMaximize}
            className="flex w-[46px] items-center justify-center text-muted transition-colors hover:bg-el hover:text-text cursor-pointer"
         >
            {maximized ? <Copy size={14} /> : <Square size={14} />}
         </button>
         <button
            type="button"
            onClick={handleClose}
            title={t.windowClose}
            aria-label={t.windowClose}
            className="flex w-[46px] items-center justify-center text-muted transition-colors hover:bg-[var(--callout-danger-accent)] hover:text-white cursor-pointer"
         >
            <X size={16} />
         </button>
      </div>
   )
}
