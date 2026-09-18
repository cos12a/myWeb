import { useTranslation } from 'react-i18next'
import { LanguageIcon } from '@heroicons/react/24/outline'

export function LanguageSwitcher() {
  const { i18n } = useTranslation()

  const toggleLanguage = () => {
    const next = i18n.language.startsWith('zh') ? 'en' : 'zh'
    i18n.changeLanguage(next)
  }

  return (
    <button
      onClick={toggleLanguage}
      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-300 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800 transition-colors"
      aria-label="Switch language"
      title={`Switch to ${i18n.language.startsWith('zh') ? 'English' : '中文'}`}
    >
      <LanguageIcon className="w-4 h-4" />
      <span>{i18n.language.startsWith('zh') ? 'EN' : '中'}</span>
    </button>
  )
}

export default LanguageSwitcher
