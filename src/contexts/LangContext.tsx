/**
 * LangContext, Provides the active language, its setter, and the resolved
 * translation object to the entire component tree.
 *
 * Exports: useLang, LangProvider
 *
 * Wraps i18n.ts translations so components consume a single typed `t` object
 * rather than importing the translations map and indexing it themselves.
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
