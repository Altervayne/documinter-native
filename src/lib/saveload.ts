import type { DocMeta, DocState, Section } from '../types'

function slugify(str: string): string {
  return (str || 'doc').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function downloadJSON(meta: DocMeta, sections: Section[]): void {
  const state: DocState = { meta, sections }
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = slugify(meta.title) + '.documinter.json'
  a.click()
  URL.revokeObjectURL(url)
}

export function loadJSONFile(onLoad: (state: DocState) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const raw = JSON.parse(e.target?.result as string) as DocState
        if (!raw.meta || !Array.isArray(raw.sections)) {
          alert('Invalid Documint JSON file.')
          return
        }
        onLoad(raw)
      } catch {
        alert('Could not parse JSON file.')
      }
    }
    reader.readAsText(file)
  }
  input.click()
}
