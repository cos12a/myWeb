import { forwardRef, useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Button from './ui/Button'
import Tooltip from './ui/Tooltip'
import { PlayIcon, PauseIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon, CameraIcon, ArrowDownTrayIcon, CogIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { ChartExportOptions } from '../utils/chartExport'

interface Props {
  frozen: boolean
  onToggleFrozen: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onSavePng: () => Promise<void> | void
  onExportCsv: (options: ChartExportOptions) => void
  onShowSettings: () => void
  onClearChart: () => void
  hasData: boolean
}

const PlotToolsOverlay = forwardRef<HTMLDivElement, Props>(function PlotToolsOverlay({ frozen, onToggleFrozen, onZoomIn, onZoomOut, onSavePng, onExportCsv, onShowSettings, onClearChart, hasData }, ref) {
  const { t } = useTranslation()
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false)
      }
    }

    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showExportMenu])
  return (
    <div className="flex items-center gap-2" ref={ref}>
      <Tooltip label={frozen ? t('tools.resume') : t('tools.freeze')}>
        <Button id="tour-tool-freeze" size="sm" variant="neutral" aria-label={frozen ? 'Play' : 'Pause'} onClick={onToggleFrozen}>
          {frozen ? (
            <PlayIcon className="w-5 h-5" />
          ) : (
            <PauseIcon className="w-5 h-5" />
          )}
        </Button>
      </Tooltip>
      <Tooltip label={t('tools.zoomIn')}>
        <Button id="tour-tool-zoomin" size="sm" variant="neutral" aria-label={t('tools.zoomIn')} onClick={onZoomIn}>
          <MagnifyingGlassPlusIcon className="w-5 h-5" />
        </Button>
      </Tooltip>
      <Tooltip label={t('tools.zoomOut')}>
        <Button id="tour-tool-zoomout" size="sm" variant="neutral" aria-label={t('tools.zoomOut')} onClick={onZoomOut}>
          <MagnifyingGlassMinusIcon className="w-5 h-5" />
        </Button>
      </Tooltip>
      
      {/* CSV Export Button with Dropdown */}
      <div className="relative" ref={exportMenuRef}>
        <Tooltip label={t('tools.exportCsv')}>
          <Button 
            id="tour-tool-export"
            size="sm" 
            variant="neutral" 
            aria-label={t('tools.exportCsv')} 
            disabled={!hasData}
            onClick={() => setShowExportMenu(!showExportMenu)}
          >
            <ArrowDownTrayIcon className="w-5 h-5" />
          </Button>
        </Tooltip>
        
        {showExportMenu && (
          <div className="absolute right-0 top-full mt-1 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-md shadow-lg z-10 min-w-48">
            <div className="p-2 space-y-1">
              <button
                onClick={() => {
                  onExportCsv({ scope: 'visible', includeTimestamps: true, timeFormat: 'iso' })
                  setShowExportMenu(false)
                }}
                className="w-full text-left px-2 py-1 text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded"
              >
                📊 {t('tools.exportVisibleData')}
              </button>
              <button
                onClick={() => {
                  onExportCsv({ scope: 'all', includeTimestamps: true, timeFormat: 'iso' })
                  setShowExportMenu(false)
                }}
                className="w-full text-left px-2 py-1 text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded"
              >
                📈 {t('tools.exportAllData')}
              </button>
              <div className="border-t border-gray-200 dark:border-neutral-700 my-1" />
              <button
                onClick={() => {
                  onExportCsv({ scope: 'visible', includeTimestamps: true, timeFormat: 'relative' })
                  setShowExportMenu(false)
                }}
                className="w-full text-left px-2 py-1 text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded"
              >
                ⏱️ {t('tools.visibleRelativeTime')}
              </button>
              <button
                onClick={() => {
                  onExportCsv({ scope: 'all', includeTimestamps: true, timeFormat: 'relative' })
                  setShowExportMenu(false)
                }}
                className="w-full text-left px-2 py-1 text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded"
              >
                ⏱️ {t('tools.allDataRelativeTime')}
              </button>
            </div>
          </div>
        )}
      </div>
      
      <Tooltip label={t('tools.savePng')}>
        <Button id="tour-tool-savepng" size="sm" variant="neutral" aria-label={t('tools.savePng')} onClick={onSavePng}>
          <CameraIcon className="w-5 h-5" />
        </Button>
      </Tooltip>

      <Tooltip label={t('tools.clearChart')}>
        <Button id="tour-tool-clearchart" size="sm" variant="danger" aria-label={t('tools.clearChart')} onClick={onClearChart} disabled={!hasData}>
          <TrashIcon className="w-5 h-5" />
        </Button>
      </Tooltip>

      <Tooltip label={t('tools.settings')}>
        <Button id="tour-tool-settings" size="sm" variant="neutral" aria-label={t('tools.settings')} onClick={onShowSettings}>
          <CogIcon className="w-5 h-5" />
        </Button>
      </Tooltip>
    </div>
  )
})

export default PlotToolsOverlay


