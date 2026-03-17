import { useCallback, useState } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import type { Block, BlockType, DocMeta, DocState, Section } from './types'
import { mkBlock, mkSection, resetCounters } from './lib/state'
import { Topbar } from './organisms/Topbar'
import { Panel } from './organisms/Panel'
import { WysiwygArea } from './organisms/WysiwygArea'
import { Toast } from './atoms/Toast'

const EMPTY_META: DocMeta = { module: '', title: '', author: '', date: '', env: '' }

interface UndoEntry {
  type: 'section' | 'block'
  // section delete
  section?: Section
  sectionIndex?: number
  // block delete
  secId?: number
  block?: Block
  blockIndex?: number
}

// ─── Immutable array helpers ────────────────────────────────────────────────
function moveItem<T>(arr: T[], fromIdx: number, toIdx: number): T[] {
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= arr.length || toIdx >= arr.length) return arr
  const next = [...arr]
  ;[next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]]
  return next
}

export default function App() {
  const [sections, setSections] = useState<Section[]>(() => [mkSection()])
  const [meta, setMeta]         = useState<DocMeta>(EMPTY_META)
  const [panelOpen, setPanelOpen] = useState(true)

  // Toast + undo
  const [toast, setToast]         = useState('')
  const [toastAction, setToastAction] = useState<{ label: string; onClick: () => void } | undefined>()
  const [, setUndoEntry] = useState<UndoEntry | null>(null)

  function showToast(msg: string, action?: { label: string; onClick: () => void }) {
    setToast(msg)
    setToastAction(action)
  }
  function clearToast() {
    setToast('')
    setToastAction(undefined)
    setUndoEntry(null)
  }

  // ── Meta ──────────────────────────────────────────────────────────────────
  const handleMetaChange = useCallback((patch: Partial<DocMeta>) => {
    setMeta(m => ({ ...m, ...patch }))
  }, [])

  // ── Load state from JSON ──────────────────────────────────────────────────
  const handleLoad = useCallback((state: DocState) => {
    const normalised = resetCounters(state)
    setMeta(normalised.meta)
    setSections(normalised.sections)
  }, [])

  // ── Section mutations ─────────────────────────────────────────────────────
  const addSection = useCallback(() => {
    setSections(s => [...s, mkSection()])
  }, [])

  const toggleSec = useCallback((secId: number) => {
    setSections(s => s.map(sec => sec.id === secId ? { ...sec, collapsed: !sec.collapsed } : sec))
  }, [])

  const updateSecTitle = useCallback((secId: number, title: string) => {
    setSections(s => s.map(sec => sec.id === secId ? { ...sec, title } : sec))
  }, [])

  const moveSecUp = useCallback((secId: number) => {
    setSections(s => {
      const i = s.findIndex(sec => sec.id === secId)
      return moveItem(s, i, i - 1)
    })
  }, [])

  const moveSecDown = useCallback((secId: number) => {
    setSections(s => {
      const i = s.findIndex(sec => sec.id === secId)
      return moveItem(s, i, i + 1)
    })
  }, [])

  const reorderSections = useCallback((oldIdx: number, newIdx: number) => {
    setSections(s => arrayMove(s, oldIdx, newIdx))
  }, [])

  const removeSec = useCallback((secId: number) => {
    setSections(s => {
      const idx = s.findIndex(sec => sec.id === secId)
      const section = s[idx]
      if (!section) return s
      const entry: UndoEntry = { type: 'section', section, sectionIndex: idx }
      setUndoEntry(entry)
      showToast('Section deleted', {
        label: 'Undo',
        onClick: () => {
          setSections(cur => {
            const next = [...cur]
            next.splice(idx, 0, section)
            return next
          })
          clearToast()
        },
      })
      return s.filter(sec => sec.id !== secId)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Block mutations ───────────────────────────────────────────────────────
  function mutateSec(secId: number, fn: (sec: Section) => Section) {
    setSections(s => s.map(sec => sec.id === secId ? fn(sec) : sec))
  }

  const addBlock = useCallback((secId: number, type: BlockType) => {
    mutateSec(secId, sec => ({ ...sec, blocks: [...sec.blocks, mkBlock(type)] }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const updateBlock = useCallback((secId: number, blkId: number, patch: Partial<Block>) => {
    mutateSec(secId, sec => ({
      ...sec,
      blocks: sec.blocks.map(b => b.id === blkId ? { ...b, ...patch } : b),
    }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const removeBlk = useCallback((secId: number, blkId: number) => {
    setSections(s => s.map(sec => {
      if (sec.id !== secId) return sec
      const idx = sec.blocks.findIndex(b => b.id === blkId)
      const block = sec.blocks[idx]
      if (!block) return sec
      const entry: UndoEntry = { type: 'block', secId, block, blockIndex: idx }
      setUndoEntry(entry)
      showToast('Block deleted', {
        label: 'Undo',
        onClick: () => {
          setSections(cur => cur.map(s2 => {
            if (s2.id !== secId) return s2
            const next = [...s2.blocks]
            next.splice(idx, 0, block)
            return { ...s2, blocks: next }
          }))
          clearToast()
        },
      })
      return { ...sec, blocks: sec.blocks.filter(b => b.id !== blkId) }
    }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const moveBlkUp = useCallback((secId: number, blkId: number) => {
    mutateSec(secId, sec => {
      const i = sec.blocks.findIndex(b => b.id === blkId)
      return { ...sec, blocks: moveItem(sec.blocks, i, i - 1) }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const moveBlkDown = useCallback((secId: number, blkId: number) => {
    mutateSec(secId, sec => {
      const i = sec.blocks.findIndex(b => b.id === blkId)
      return { ...sec, blocks: moveItem(sec.blocks, i, i + 1) }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reorderBlocks = useCallback((secId: number, oldIdx: number, newIdx: number) => {
    mutateSec(secId, sec => ({ ...sec, blocks: arrayMove(sec.blocks, oldIdx, newIdx) }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── List helpers ──────────────────────────────────────────────────────────
  const addListItem = useCallback((secId: number, blkId: number) => {
    mutateSec(secId, sec => ({
      ...sec,
      blocks: sec.blocks.map(b =>
        b.id === blkId && b.type === 'list'
          ? { ...b, items: [...(b.items ?? []), 'New item'] }
          : b
      ),
    }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const removeLastItem = useCallback((secId: number, blkId: number) => {
    mutateSec(secId, sec => ({
      ...sec,
      blocks: sec.blocks.map(b =>
        b.id === blkId && b.type === 'list' && (b.items?.length ?? 0) > 1
          ? { ...b, items: b.items!.slice(0, -1) }
          : b
      ),
    }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Table helpers ─────────────────────────────────────────────────────────
  const addTableRow = useCallback((secId: number, blkId: number) => {
    mutateSec(secId, sec => ({
      ...sec,
      blocks: sec.blocks.map(b =>
        b.id === blkId && b.type === 'table'
          ? { ...b, rows: [...(b.rows ?? []), (b.headers ?? []).map(() => '')] }
          : b
      ),
    }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const removeLastRow = useCallback((secId: number, blkId: number) => {
    mutateSec(secId, sec => ({
      ...sec,
      blocks: sec.blocks.map(b =>
        b.id === blkId && b.type === 'table' && (b.rows?.length ?? 0) > 1
          ? { ...b, rows: b.rows!.slice(0, -1) }
          : b
      ),
    }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addTableCol = useCallback((secId: number, blkId: number) => {
    mutateSec(secId, sec => ({
      ...sec,
      blocks: sec.blocks.map(b =>
        b.id === blkId && b.type === 'table'
          ? {
              ...b,
              headers: [...(b.headers ?? []), 'Column'],
              rows: (b.rows ?? []).map(r => [...r, '']),
            }
          : b
      ),
    }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Topbar
        meta={meta}
        sections={sections}
        onLoad={handleLoad}
        onToast={msg => showToast(msg)}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Panel
          open={panelOpen}
          onToggle={() => setPanelOpen(o => !o)}
          sections={sections}
          onAddSection={addSection}
          onToggleSec={toggleSec}
          onMoveSecUp={moveSecUp}
          onMoveSecDown={moveSecDown}
          onRemoveSec={removeSec}
          onAddBlock={addBlock}
          onMoveBlkUp={moveBlkUp}
          onMoveBlkDown={moveBlkDown}
          onRemoveBlk={removeBlk}
          onReorderSections={reorderSections}
          onReorderBlocks={reorderBlocks}
        />

        <WysiwygArea
          meta={meta}
          sections={sections}
          onUpdateMeta={handleMetaChange}
          onUpdateTitle={updateSecTitle}
          onUpdateBlock={updateBlock}
          onAddBlock={addBlock}
          onRemoveSec={removeSec}
          onRemoveBlk={removeBlk}
          onAddListItem={addListItem}
          onRemoveLastItem={removeLastItem}
          onAddTableRow={addTableRow}
          onRemoveLastRow={removeLastRow}
          onAddTableCol={addTableCol}
          onReorderSections={reorderSections}
          onReorderBlocks={reorderBlocks}
        />
      </div>

      <Toast message={toast} action={toastAction} onDone={clearToast} />
    </>
  )
}
