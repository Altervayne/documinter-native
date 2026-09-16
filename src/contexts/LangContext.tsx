/*
 * Active language, its setter, and the resolved translations, so components read one typed `t`
 * instead of indexing the translations map themselves.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { translations, type Lang, type T } from '../lib/i18n'

interface LangCtx {
   lang:    Lang
   setLang: (language: Lang) => void
   t:       T
}

const LangContext = createContext<LangCtx>(null!)

export function useLang() {
   return useContext(LangContext)
}

export function LangProvider({ lang, setLang, children }: { lang: Lang; setLang: (language: Lang) => void; children: ReactNode }) {
   const value = useMemo(() => ({ lang, setLang, t: translations[lang] }), [lang, setLang])
   return (
      <LangContext.Provider value={value}>
         {children}
      </LangContext.Provider>
   )
}
