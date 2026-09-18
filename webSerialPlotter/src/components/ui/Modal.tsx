import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const labelId = useId()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    prevFocusRef.current = (document.activeElement as HTMLElement) || null
    const panel = panelRef.current
    if (panel) {
      // Focus the first focusable element
      const focusable = panel.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      ;(focusable ?? panel).focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab') {
        // Simple focus trap
        const nodes = panel?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (!nodes || nodes.length === 0) return
        const elements = Array.from(nodes)
        const first = elements[0]
        const last = elements[elements.length - 1]
        const active = document.activeElement as HTMLElement
        if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prevFocusRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const overlay = (
    <div ref={containerRef} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? labelId : undefined}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md min-w-[20rem] rounded-lg border bg-white text-gray-900 border-gray-300 p-4 shadow-lg dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-700"
      >
        {title ? <div id={labelId} className="text-sm font-semibold mb-3">{title}</div> : null}
        {children}
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}

export default Modal


