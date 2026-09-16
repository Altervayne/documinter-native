import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// These package styles must load BEFORE index.css so the `.pqc-root` / `.paw-window` theme overrides
// in index.css win over the packages' own defaults.
import 'react-piqua-color/style.css'
import 'react-pop-a-window/styles.css'
import './index.css'
import App from './App.tsx'
import { ToastProvider } from './contexts/ToastContext'
import { BinderBackendProvider } from './contexts/BinderBackendContext'
import { NativeBinderHost } from './organisms/NativeBinderHost'
import { isTauri } from './lib/platform'

// Native has no default Binder: NativeBinderHost owns the active-Binder state and provides the filesystem
// backend itself (own ToastProvider + App). Web mounts the provider's default IndexedDB backend.
createRoot(document.getElementById('root')!).render(
   <StrictMode>
      {isTauri() ? (
         <NativeBinderHost />
      ) : (
         <BinderBackendProvider>
            <ToastProvider>
               <App />
            </ToastProvider>
         </BinderBackendProvider>
      )}
   </StrictMode>,
)
