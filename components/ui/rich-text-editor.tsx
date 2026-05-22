'use client'

import { useRef, useEffect, useCallback } from 'react'
import { cn, sanitizeWordHtml } from '@/lib/utils'

interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  minHeight?: string
  disabled?: boolean
}

function insertHtmlAtCursor(html: string) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const el = document.createElement('div')
  el.innerHTML = html
  const frag = document.createDocumentFragment()
  let lastNode: Node | null = null
  while (el.firstChild) {
    lastNode = el.firstChild
    frag.appendChild(el.firstChild)
  }
  range.insertNode(frag)
  if (lastNode) {
    const newRange = range.cloneRange()
    newRange.setStartAfter(lastNode)
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)
  }
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = '',
  className,
  minHeight = '200px',
  disabled = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const isFocused = useRef(false)

  // Sync external value → DOM only when not focused (avoids cursor jump while typing)
  useEffect(() => {
    if (editorRef.current && !isFocused.current) {
      editorRef.current.innerHTML = value
    }
  }, [value])

  const handleInput = useCallback(() => {
    if (editorRef.current) onChange(editorRef.current.innerHTML)
  }, [onChange])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    // Strip Word/Outlook overhead when HTML contains MSO markers, then fall back to plain text
    const isWord = /mso-|ProgId=|<!--\[if gte mso/i.test(html)
    const content = html ? (isWord ? sanitizeWordHtml(html) : html) : text.replace(/\n/g, '<br>')
    insertHtmlAtCursor(content)
    if (editorRef.current) onChange(editorRef.current.innerHTML)
  }, [onChange])

  return (
    <div className="relative">
      {!value && (
        <span className="absolute left-3 top-2 text-sm text-muted-foreground pointer-events-none select-none">
          {placeholder}
        </span>
      )}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onFocus={() => { isFocused.current = true }}
        onBlur={() => { isFocused.current = false }}
        onInput={handleInput}
        onPaste={handlePaste}
        className={cn(
          'min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
          'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          // Table rendering for pasted tables
          '[&_table]:border-collapse [&_table]:w-full [&_table]:my-2 [&_table]:text-sm',
          '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top',
          '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted [&_th]:font-semibold',
          // Basic text formatting
          '[&_p]:my-1 [&_br]:block',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        style={{ minHeight }}
      />
    </div>
  )
}
