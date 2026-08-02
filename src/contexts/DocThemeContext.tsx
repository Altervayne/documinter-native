/**
 * DocThemeContext, Provides the active document theme ('light' | 'dark') to blocks that must
 * bake theme-specific colors into their own markup (the graph block, whose SVG carries literal
 * hex rather than CSS variables, the same reason the HTML export bakes a single theme).
 *
 * Exports: DocThemeProvider, useDocTheme
 *
 * Provided once at the WysiwygArea root (which already knows `docTheme`), so any block deep in
 * the tree reads it without prop-threading through every section / block / container layer.
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
