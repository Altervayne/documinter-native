/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { translations, type Lang, type T } from './i18n'

interface LangCtx {
   lang: Lang
   setLang: (l: Lang) => void
   t: T
}

const LangContext = createContext<LangCtx>(null!)

export function useLang() {
   return useContext(LangContext)
}

export function LangProvider({ lang, setLang, children }: { lang: Lang; setLang: (l: Lang) => void; children: ReactNode }) {
   const value = useMemo(() => ({ lang, setLang, t: translations[lang] }), [lang, setLang])
   return (
      <LangContext.Provider value={value}>
         {children}
      </LangContext.Provider>
   )
}
