import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// react-piqua-color + react-pop-a-window base styles must load BEFORE index.css so the `.pqc-root`
// and `.paw-window` theme overrides below (in index.css) win over the packages' own defaults.
import 'react-piqua-color/style.css'
import 'react-pop-a-window/styles.css'
import './index.css'
import App from './App.tsx'
import { ToastProvider } from './contexts/ToastContext'
import { BinderBackendProvider } from './contexts/BinderBackendContext'
import { NativeBinderHost } from './organisms/NativeBinderHost'
import { isTauri } from './lib/platform'

// On native there is no default Binder: NativeBinderHost owns the active-Binder state, shows the Welcome
// picker until one is open, and provides the filesystem backend itself (with its own ToastProvider + App).
// On the web the mount is unchanged: the IndexedDB backend is the provider's default.
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
