/*
 * The active document theme, for blocks that bake theme-specific colors into their own markup: the
 * graph block's SVG carries literal hex, not CSS variables, so it needs to know light vs dark.
 * Provided once at the WysiwygArea root, so a deep block reads it without prop-threading.
 */

/* eslint-disable react-refresh/only-export-components -- context + hook co-location is intentional */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

const DocThemeContext = createContext<'light' | 'dark'>('light')

export function DocThemeProvider({ theme, children }: { theme: 'light' | 'dark'; children: ReactNode }) {
   return <DocThemeContext.Provider value={theme}>{children}</DocThemeContext.Provider>
}

export function useDocTheme(): 'light' | 'dark' {
   return useContext(DocThemeContext)
}
