import { createContext, useContext, type ReactNode } from 'react'
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
  return (
    <LangContext.Provider value={{ lang, setLang, t: translations[lang] }}>
      {children}
    </LangContext.Provider>
  )
}
