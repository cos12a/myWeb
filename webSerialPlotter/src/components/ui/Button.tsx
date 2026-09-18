import React from 'react'

type Variant = 'neutral' | 'primary' | 'danger'
type Size = 'sm' | 'md'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  startIcon?: React.ReactNode
  endIcon?: React.ReactNode
}

function classesFor(variant: Variant, size: Size, disabled?: boolean) {
  const base = 'inline-flex items-center justify-center rounded-md border font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-0 select-none'
  const sz = size === 'sm' ? 'text-xs px-2 py-1' : 'text-sm px-3 py-1.5'
  const neutral = 'bg-white text-gray-900 border-gray-300 hover:bg-gray-50 dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
  const primary = 'bg-blue-600 text-white border-blue-600 hover:bg-blue-500 dark:bg-blue-600 dark:hover:bg-blue-500'
  const danger = 'bg-red-600 text-white border-red-600 hover:bg-red-500'
  const variantCls = variant === 'primary' ? primary : variant === 'danger' ? danger : neutral
  const state = disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
  return [base, sz, variantCls, state].join(' ')
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'neutral',
  size = 'md',
  className,
  disabled,
  style,
  startIcon,
  endIcon,
  ...props
}, ref) {
  const ring = variant === 'primary' ? 'var(--accent-hover)' : variant === 'danger' ? 'var(--danger-hover)' : 'var(--control-border)'
  const cssStyle: React.CSSProperties & { ['--ring']?: string } = { ...(style as React.CSSProperties), ['--ring']: ring }
  const content = (
    <span className="inline-flex items-center gap-2">
      {startIcon ? <span className="shrink-0" aria-hidden>{startIcon}</span> : null}
      {props.children}
      {endIcon ? <span className="shrink-0" aria-hidden>{endIcon}</span> : null}
    </span>
  )
  return (
    <button ref={ref} className={[classesFor(variant, size, disabled), className].filter(Boolean).join(' ')} disabled={disabled} style={cssStyle} {...props}>
      {content}
    </button>
  )
})

export default Button


