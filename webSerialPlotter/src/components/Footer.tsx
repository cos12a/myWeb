import { useTranslation } from 'react-i18next'
import { BookOpenIcon, ShoppingCartIcon, CodeBracketIcon } from '@heroicons/react/24/outline'

interface Props {
  giteeUrl: string
  shopUrl: string
  tutorialUrl: string
  esp32ToolUrl?: string
  blogUrl?: string
}

export default function Footer({ giteeUrl, shopUrl, tutorialUrl, esp32ToolUrl, blogUrl }: Props) {
  const { t } = useTranslation()
  return (
    <footer className="flex items-center justify-center gap-4 py-2 px-4 text-xs text-gray-500 dark:text-neutral-400 border-t border-gray-200 dark:border-neutral-800">
      <a
        href={giteeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-neutral-200 transition-colors"
      >
        <CodeBracketIcon className="w-4 h-4" />
        Gitee
      </a>
      
      <span className="text-gray-300 dark:text-neutral-600">•</span>
      
      {esp32ToolUrl && (
        <>
          <a
            href={esp32ToolUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-neutral-200 transition-colors"
          >
            {t('footer.esp32Tool')}
          </a>
          <span className="text-gray-300 dark:text-neutral-600">•</span>
        </>
      )}

      {blogUrl && (
        <>
          <a
            href={blogUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-neutral-200 transition-colors"
          >
            {t('footer.blog')}
          </a>
          <span className="text-gray-300 dark:text-neutral-600">•</span>
        </>
      )}

      <a
        href={tutorialUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-neutral-200 transition-colors"
      >
        <BookOpenIcon className="w-4 h-4" />
        {t('footer.tutorial')}
      </a>
      
      <span className="text-gray-300 dark:text-neutral-600">•</span>
      
      <a
        href={shopUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-neutral-200 transition-colors"
      >
        <ShoppingCartIcon className="w-4 h-4" />
        {t('footer.shop')}
      </a>

      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] text-gray-400 dark:text-neutral-600 hover:text-gray-500 dark:hover:text-neutral-500 transition-colors no-underline"
      >
        粤ICP备2025393310号-2
      </a>
      <span className="text-[10px] text-gray-400 dark:text-neutral-600">
        粤公网安备 44030002011217号
      </span>
    </footer>
  )
}