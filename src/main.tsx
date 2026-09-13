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

createRoot(document.getElementById('root')!).render(
   <StrictMode>
      <BinderBackendProvider>
         <ToastProvider>
            <App />
         </ToastProvider>
      </BinderBackendProvider>
   </StrictMode>,
)
