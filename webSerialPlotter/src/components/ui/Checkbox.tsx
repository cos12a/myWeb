import React from 'react'

export type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ className, ...props }, ref) {
  const base = 'accent-blue-600'
  return <input ref={ref} type="checkbox" className={[base, className].filter(Boolean).join(' ')} {...props} />
})

export default Checkbox


