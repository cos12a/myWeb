import { useTranslation } from 'react-i18next'

interface TabNavProps {
  activeTab: 'chart' | 'console'
  onTabChange: (tab: 'chart' | 'console') => void
}

export default function TabNav({ activeTab, onTabChange }: TabNavProps) {
  const { t } = useTranslation()
  return (
    <div className="flex border-b border-gray-200 dark:border-neutral-800">
      <button
        id="tour-tab-chart"
        onClick={() => onTabChange('chart')}
        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
          activeTab === 'chart'
            ? 'border-blue-500 text-blue-600 dark:text-blue-400 dark:border-blue-400'
            : 'border-transparent text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 hover:border-gray-300 dark:hover:border-neutral-600'
        }`}
      >
        {t('tabs.chart')}
      </button>
      <button
        id="tour-tab-console"
        onClick={() => onTabChange('console')}
        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
          activeTab === 'console'
            ? 'border-blue-500 text-blue-600 dark:text-blue-400 dark:border-blue-400'
            : 'border-transparent text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 hover:border-gray-300 dark:hover:border-neutral-600'
        }`}
      >
        {t('tabs.console')}
      </button>
    </div>
  )
}