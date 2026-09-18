import './App.css'
import Header from './components/Header'
import ThemeToggle from './components/ThemeToggle'
import PlotCanvas, { type PlotCanvasHandle } from './components/PlotCanvas'
import SettingsPanel from './components/SettingsPanel'
// GeneratorPanel removed - now integrated into connect modal
import StatsPanel from './components/StatsPanel'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDataConnection } from './hooks/useDataConnection'
import { useDataStore } from './store/dataStore'
import { useConsoleStore } from './hooks/useConsoleStore'
import Legend from './components/Legend'
// icons used within PlotToolsOverlay; no direct use here
import { captureElementPng, downloadDataUrlPng } from './utils/screenshot'
import PlotToolsOverlay from './components/PlotToolsOverlay'
import TabNav from './components/TabNav'
import SerialConsole from './components/SerialConsole'
import Footer from './components/Footer'
import LanguageSwitcher from './components/LanguageSwitcher'
import { exportChartData, type ChartExportOptions } from './utils/chartExport'
import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

function App() {
  const { t } = useTranslation()
  const store = useDataStore()
  const consoleStore = useConsoleStore()
  const [autoscale, setAutoscale] = useState(true)
  const [manualMinInput, setManualMinInput] = useState('-1')
  const [manualMaxInput, setManualMaxInput] = useState('1')
  const [timeMode, setTimeMode] = useState<'absolute' | 'relative'>('absolute')
  const [activeTab, setActiveTab] = useState<'chart' | 'console'>('chart')
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const pendingIncomingLinesRef = useRef<string[]>([])
  const queuedDrainRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const MAX_LINES_PER_BATCH = 16
  const tourSteps = useMemo(() => ([
    {
      element: '#tour-connect-button',
      popover: { title: t('tour.connectTitle'), description: t('tour.connectDesc') },
    },
    {
      element: '#tour-tab-console',
      popover: { title: t('tour.consoleTitle'), description: t('tour.consoleDesc') },
    },
    {
      element: '#tour-theme-toggle',
      popover: { title: t('tour.themeTitle'), description: t('tour.themeDesc') },
    },
    {
      element: '#tour-plot-area',
      popover: { title: t('tour.plotTitle'), description: t('tour.plotDesc') },
    },
    { element: '#tour-tool-freeze', popover: { title: t('tour.freezeTitle'), description: t('tour.freezeDesc') } },
    { element: '#tour-tool-zoomin', popover: { title: t('tour.zoomInTitle'), description: t('tour.zoomInDesc') } },
    { element: '#tour-tool-zoomout', popover: { title: t('tour.zoomOutTitle'), description: t('tour.zoomOutDesc') } },
    { element: '#tour-tool-export', popover: { title: t('tour.exportTitle'), description: t('tour.exportDesc') } },
    { element: '#tour-tool-savepng', popover: { title: t('tour.savePngTitle'), description: t('tour.savePngDesc') } },
    { element: '#tour-tool-settings', popover: { title: t('tour.settingsTitle'), description: t('tour.settingsDesc') } },
  ] as const), [t])

  const runDriverTour = useCallback(() => {
    const d = driver({
      showProgress: true,
      allowClose: true,
      overlayOpacity: 0.5,
      steps: tourSteps as unknown as Array<{ element: string; popover: { title: string; description: string } }>,
    })
    d.drive()
  }, [tourSteps])

  const processIncomingLine = useCallback((line: string) => {
    // Send to console store (always log all incoming data)
    consoleStore.addIncoming(line)

    // Parse for chart (existing logic)
    if (line.trim().startsWith('#')) {
      const names = line
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .replace(/^\s*#+\s*/, '')
        .split(/[\s,\t]+/)
        .filter(Boolean)
      if (names.length > 0) store.setSeries(names)
      return
    }
    const parts = line
      .trim()
      .replace(/^\(/, '')
      .replace(/\)$/, '')
      .split(/[\s,\t]+/)
      .filter(Boolean)
    if (parts.length === 0) return
    const values: number[] = []
    for (const p of parts) {
      const v = Number(p)
      if (Number.isFinite(v)) values.push(v)
    }
    if (values.length > 0) store.append(values)
  }, [store, consoleStore])

  const flushPendingIncomingLines = useCallback(() => {
    queuedDrainRef.current = null
    const queued = pendingIncomingLinesRef.current
    pendingIncomingLinesRef.current = []

    let processed = 0
    while (queued.length > 0 && processed < MAX_LINES_PER_BATCH) {
      const nextLine = queued.shift()
      if (nextLine === undefined) break
      processIncomingLine(nextLine)
      processed += 1
    }

    if (queued.length > 0) {
      queuedDrainRef.current = globalThis.setTimeout(flushPendingIncomingLines, 0)
    }
  }, [processIncomingLine])

  const handleIncomingLine = useCallback((line: string) => {
    pendingIncomingLinesRef.current.push(line)
    if (queuedDrainRef.current !== null) return
    queuedDrainRef.current = globalThis.setTimeout(flushPendingIncomingLines, 0)
  }, [flushPendingIncomingLines])

  const dataConnection = useDataConnection(handleIncomingLine)

  const canvasRef = useRef<PlotCanvasHandle | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const plotContainerRef = useRef<HTMLDivElement | null>(null)
  const toolsRef = useRef<HTMLDivElement | null>(null)
  const [statsHeightPx, setStatsHeightPx] = useState(240)

  // Compute a single viewport snapshot per render to reuse across sections
  const snap = store.getViewPortData()
  const hasChartData = store.writeIndex > 0

  const startDragResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const onMove = (ev: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      let h = rect.bottom - ev.clientY
      const min = 120
      const max = Math.max(min, rect.height - 120)
      h = Math.max(min, Math.min(max, h))
      setStatsHeightPx(h)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [setStatsHeightPx])

  const handleExportCsv = useCallback((options: ChartExportOptions) => {
    exportChartData(snap, store, options)
  }, [snap, store])

  useEffect(() => {
    return () => {
      if (queuedDrainRef.current !== null) {
        globalThis.clearTimeout(queuedDrainRef.current)
      }
    }
  }, [])

  // settings toggled inline via toolbar button
  useEffect(() => {
    try {
      const seen = localStorage.getItem('wsp.tour.seen')
      if (!seen) {
        runDriverTour()
        localStorage.setItem('wsp.tour.seen', '1')
      }
    } catch { /* ignore persistence errors */ }
  }, [runDriverTour])


  // Removed modal save handler

  return (
    <div className="h-dvh flex flex-col bg-white text-gray-900 dark:bg-neutral-950 dark:text-neutral-100 overflow-hidden">
      {/* driver.js injects its own overlay/popover; nothing to mount here */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-neutral-800">
        <Header
          connectionState={dataConnection.state}
          onConnectSerial={dataConnection.connectSerial}
          onConnectBluetooth={dataConnection.connectBluetooth}
          onConnectGenerator={dataConnection.connectGenerator}
          onDisconnect={dataConnection.disconnect}
          generatorConfig={dataConnection.generatorConfig}
          serialSupported={dataConnection.serialSupported}
          bluetoothSupported={dataConnection.bluetoothSupported}
        />
        <div className="pr-4 flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          <button
            id="tour-help"
            className="text-xs px-2 py-1 rounded-md border border-gray-300 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            onClick={() => { try { localStorage.removeItem('wsp.tour.seen') } catch { /* ignore */ }; runDriverTour() }}
            aria-label={t('app.showHelpTour')}
            title={t('app.showHelpTour')}
          >
            {t('app.help')}
          </button>
        </div>
      </div>

      <main className="flex-1 w-full px-4 py-3 flex flex-col gap-3 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Tab Navigation */}
          <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
          
          {/* Tab Content */}
          {activeTab === 'chart' ? (
            <div className="mt-2 flex-1 min-h-0 flex flex-col gap-2">
              {/* Tools toolbar above plot */}
              <div className="flex items-center justify-end">
                <PlotToolsOverlay
                  ref={toolsRef}
                  frozen={store.getFrozen()}
                  hasData={hasChartData}
                  onToggleFrozen={() => {
                    store.stopMomentum()
                    if (!store.getFrozen()) {
                      store.setFrozen(true)
                    } else {
                      store.setViewPortCursor(0)
                      store.setFrozen(false)
                    }
                  }}
                  onZoomIn={() => store.zoomByFactor(1.25)}
                  onZoomOut={() => store.zoomByFactor(0.8)}
                  onExportCsv={handleExportCsv}
                  onShowSettings={() => setShowSettingsPanel((v) => !v)}
                  onSavePng={async () => {
                    const node = plotContainerRef.current
                    if (!node) return
                    const bg = getComputedStyle(document.documentElement).getPropertyValue('--plot-bg') || '#fff'
                    const dataUrl = await captureElementPng(node, { pixelRatio: 2, backgroundColor: bg.trim() || '#fff', paddingPx: 12 })
                    downloadDataUrlPng(dataUrl, `plot-${Date.now()}.png`)
                  }}
                  onClearChart={() => {
                    // Reset the store with current capacity, viewport size and series names
                    store.reset(store.getCapacity(), store.getViewPortSize(), store.getSeries().map(x=>x.name))
                  }}
                />
              </div>

              <div className="flex-1 min-h-0 flex">
                <div
                  className="flex-1 min-h-0 grid"
                  ref={containerRef}
                  style={{ gridTemplateRows: `minmax(0,1fr) 6px ${statsHeightPx}px` }}
                >
                  <div className="relative w-full h-full" ref={plotContainerRef}>
                  <PlotCanvas
                    ref={canvasRef}
                    snapshot={snap}
                    interactionsEnabled={!showSettingsPanel}
                    yOverride={(() => {
                      if (autoscale) return null
                      const min = parseFloat(manualMinInput)
                      const max = parseFloat(manualMaxInput)
                      if (Number.isFinite(min) && Number.isFinite(max)) return { min, max }
                      return null
                    })()} timeMode={timeMode}
                    onPanStart={() => {
                      store.stopMomentum()
                      if (!store.getFrozen()) {
                        store.setFrozen(true)
                      }
                    }}
                    onPanDelta={(delta) => {
                      store.setViewPortCursor(store.getViewPortCursor() - delta)
                    }}
                    onPanEnd={(endV) => {
                      store.startMomentum(-endV)
                    }}
                    onZoomFactor={(factor) => store.zoomByFactor(factor)}
                    showHoverTooltip={true}
                  />
                  {/* Legend overlay bottom-right if data present */}
                  {hasChartData && (
                    <div className="absolute top-8 right-2 pointer-events-auto">
                      <Legend />
                    </div>
                  )}
                  {snap.viewPortSize === 0 && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs opacity-50">
                      {t('app.noData')}
                    </div>
                  )}
                  </div>
                  <div
                    className="cursor-row-resize bg-neutral-800 hover:bg-neutral-700 select-none touch-none"
                    onPointerDown={startDragResize}
                  />
                  <div className="overflow-auto">
                    {snap.viewPortSize === 0 ? null : <StatsPanel snapshot={snap} />}
                  </div>
                </div>
                <SettingsPanel
                  open={showSettingsPanel}
                  settings={{
                    autoscale,
                    manualMinInput,
                    manualMaxInput,
                    capacity: store.getCapacity(),
                    maxViewPortSize: store.getMaxViewPortSize(),
                    timeMode,
                  }}
                  onChange={{
                    setAutoscale,
                    setManualMinInput,
                    setManualMaxInput,
                    setCapacity: (v) => store.setCapacity(v),
                    setMaxViewPortSize: (v) => store.setMaxViewPortSize(v),
                    setTimeMode,
                  }}
                  onClose={() => setShowSettingsPanel(false)}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <SerialConsole 
                isConnected={dataConnection.state.isConnected}
                connectionType={dataConnection.state.type}
                onSendMessage={dataConnection.write}
              />
            </div>
          )}
        </div>
        {/* Removed old bottom screenshot button; use overlay or per-card actions */}
      </main>
      
      <Footer 
        giteeUrl="https://gitee.com/eegithub/web-serial-plotter-cn"
        shopUrl="https://esp32.taobao.com/"
        tutorialUrl="https://gitee.com/eegithub/web-serial-plotter-cn"
        esp32ToolUrl="https://esp.unito.top"
        blogUrl="https://blog.csdn.net/cos12a/article/details/156298530?fromshare=blogdetail&sharetype=blogdetail&sharerId=156298530&sharerefer=PC&sharesource=cos12a&sharefrom=from_link"
      />
      </div>
  )
}

export default App
