import React from 'react'

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, children, ...props }, ref) {
  const base = 'rounded-md border text-sm px-2 py-1 bg-white text-gray-900 border-gray-300 dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500'
  return (
    <select ref={ref} className={[base, className].filter(Boolean).join(' ')} {...props}>
      {children}
    </select>
  )
})

export default Select


