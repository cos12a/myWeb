import React from 'react'

export type ColorInputProps = React.InputHTMLAttributes<HTMLInputElement>

export const ColorInput = React.forwardRef<HTMLInputElement, ColorInputProps>(function ColorInput({ className, ...props }, ref) {
  const base = 'w-8 h-8 rounded border border-gray-300 bg-white p-0 dark:border-neutral-700 dark:bg-neutral-900'
  return <input ref={ref} type="color" className={[base, className].filter(Boolean).join(' ')} {...props} />
})

export default ColorInput


