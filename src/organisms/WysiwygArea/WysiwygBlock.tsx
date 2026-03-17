import { useState } from 'react'
import type { Block, CalloutStyle, CodeLang } from '../../types'
import { ContentEditable } from '../../atoms/ContentEditable'
import { CalloutStylePicker } from '../../molecules/CalloutStylePicker'
import { highlight, LANG_LABELS } from '../../lib/highlight'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'

interface WysiwygBlockProps {
  secId: number
  block: Block
  onUpdate: (secId: number, blkId: number, patch: Partial<Block>) => void
  onRemove: () => void
  // list helpers
  onAddListItem:    () => void
  onRemoveLastItem: () => void
  // table helpers
  onAddTableRow:   () => void
  onRemoveLastRow: () => void
  onAddTableCol:   () => void
}

export function WysiwygBlock({
  secId, block,
  onUpdate, onRemove,
  onAddListItem, onRemoveLastItem,
  onAddTableRow, onRemoveLastRow, onAddTableCol,
}: WysiwygBlockProps) {
  const [codeEditing, setCodeEditing] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  function patch(p: Partial<Block>) {
    onUpdate(secId, block.id, p)
  }

  let inner: React.ReactNode

  if (block.type === 'p') {
    inner = (
      <ContentEditable
        tag="p"
        content={block.text ?? ''}
        onBlur={v => patch({ text: v })}
      />
    )
  } else if (block.type === 'h3') {
    inner = (
      <ContentEditable
        tag="h3"
        content={block.text ?? ''}
        onBlur={v => patch({ text: v })}
      />
    )
  } else if (block.type === 'h4') {
    inner = (
      <ContentEditable
        tag="h4"
        content={block.text ?? ''}
        onBlur={v => patch({ text: v })}
      />
    )
  } else if (block.type === 'callout') {
    inner = (
      <>
        <CalloutStylePicker
          current={block.style ?? 'info'}
          onChange={(style: CalloutStyle) => patch({ style })}
        />
        <ContentEditable
          tag="p"
          className={`callout ${block.style ?? 'info'}`}
          content={block.text ?? ''}
          onBlur={v => patch({ text: v })}
        />
      </>
    )
  } else if (block.type === 'code') {
    const lang = block.lang ?? 'windev'
    inner = (
      <>
        {/* Language picker */}
        <div className="lang-picker">
          <span>lang:</span>
          {(Object.keys(LANG_LABELS) as CodeLang[]).map(l => (
            <button
              key={l}
              className={lang === l ? 'active' : ''}
              onClick={() => patch({ lang: l })}
            >
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
        {/* Click-to-edit: highlighted display ↔ plain editable */}
        {codeEditing ? (
          <pre>
            <ContentEditable
              tag="code"
              content={block.code ?? ''}
              spellCheck={false}
              onBlur={v => { patch({ code: v }); setCodeEditing(false) }}
            />
          </pre>
        ) : (
          <pre
            title="Click to edit"
            onClick={() => setCodeEditing(true)}
            style={{ cursor: 'text' }}
          >
            <code dangerouslySetInnerHTML={{ __html: highlight(block.code ?? '', lang) }} />
          </pre>
        )}
      </>
    )
  } else if (block.type === 'list') {
    inner = (
      <>
        <ul>
          {(block.items ?? []).map((item, i) => (
            <ContentEditable
              key={i}
              tag="li"
              content={item}
              onBlur={v => {
                const items = [...(block.items ?? [])]
                items[i] = v
                patch({ items })
              }}
            />
          ))}
        </ul>
        <div className="wysiwyg-util-row">
          <button onClick={onAddListItem}>+ Item</button>
          <button className="danger" onClick={onRemoveLastItem}>− Last</button>
        </div>
      </>
    )
  } else if (block.type === 'table') {
    const headers = block.headers ?? []
    const rows    = block.rows ?? []
    inner = (
      <>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((h, ci) => (
                  <ContentEditable
                    key={ci}
                    tag="th"
                    content={h}
                    onBlur={v => {
                      const newHeaders = [...headers]
                      newHeaders[ci] = v
                      patch({ headers: newHeaders })
                    }}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <ContentEditable
                      key={ci}
                      tag="td"
                      content={cell}
                      onBlur={v => {
                        const newRows = rows.map(r => [...r])
                        newRows[ri][ci] = v
                        patch({ rows: newRows })
                      }}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="wysiwyg-util-row">
          <button onClick={onAddTableRow}>+ Row</button>
          <button onClick={onAddTableCol}>+ Col</button>
          <button className="danger" onClick={onRemoveLastRow}>− Row</button>
        </div>
      </>
    )
  }

  return (
    <div ref={setNodeRef} style={style} className="blk-wrap" {...attributes}>
      <div {...listeners} className="blk-drag-handle" title="Drag to reorder">
        <GripVertical size={14} />
      </div>
      <div className="blk-content">
        <button className="blk-delete" onClick={onRemove} title="Delete block">
          <Trash2 size={13} />
        </button>
        {inner}
      </div>
    </div>
  )
}
