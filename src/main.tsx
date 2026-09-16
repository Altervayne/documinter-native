import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// These package styles must load BEFORE index.css so the `.pqc-root` / `.paw-window` theme overrides
// in index.css win over the packages' own defaults.
import 'react-piqua-color/style.css'
import 'react-pop-a-window/styles.css'
import './index.css'
import { NativeBinderHost } from './organisms/NativeBinderHost'

// Native-only: NativeBinderHost owns the active-Binder state and provides the filesystem backend itself
// (its own ToastProvider + App). There is no browser build; the app runs inside the Tauri shell.
createRoot(document.getElementById('root')!).render(
   <StrictMode>
      <NativeBinderHost />
   </StrictMode>,
)
