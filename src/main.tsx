import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// react-piqua-color base styles must load BEFORE index.css so the `.pqc-root`
// theme override below (in index.css) wins over the package's own defaults.
import 'react-piqua-color/style.css'
import './index.css'
import App from './App.tsx'
import { ToastProvider } from './contexts/ToastContext'

createRoot(document.getElementById('root')!).render(
   <StrictMode>
      <ToastProvider>
         <App />
      </ToastProvider>
   </StrictMode>,
)
