import React from 'react'

interface TooltipProps {
  label: string
  side?: 'top' | 'bottom'
  children: React.ReactNode
}

export default function Tooltip({ label, side = 'bottom', children }: TooltipProps) {
  const sideClasses = side === 'top'
    ? 'bottom-full mb-1 left-1/2 -translate-x-1/2'
    : 'top-full mt-1 left-1/2 -translate-x-1/2'

  return (
    <div className="relative inline-block group">
      {children}
      <div
        role="tooltip"
        className={`pointer-events-none absolute hidden group-hover:block whitespace-nowrap rounded-md bg-black/80 text-white dark:bg-neutral-800/95 dark:text-neutral-100 text-xs px-2 py-1 shadow z-20 ${sideClasses}`}
      >
        {label}
      </div>
    </div>
  )
}


