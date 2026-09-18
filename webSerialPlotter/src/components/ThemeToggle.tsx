import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from './ui/Button'
import { MoonIcon, SunIcon } from '@heroicons/react/24/outline'

export function ThemeToggle() {
  const { t } = useTranslation()
  const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const [theme, setTheme] = useState<'dark' | 'light'>(prefersDark ? 'dark' : 'light')

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'light')
    root.classList.add(theme)
    // no persistence
  }, [theme])

  return (
    <Button
      id="tour-theme-toggle"
      size="sm"
      aria-label={t('theme.toggle')}
      title={t('theme.toggleLightDark')}
      onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      startIcon={theme === 'dark' ? <MoonIcon className="w-4 h-4" /> : <SunIcon className="w-4 h-4" />}
    />
  )
}

export default ThemeToggle


