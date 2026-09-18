import * as htmlToImage from 'html-to-image'

export interface CaptureElementOptions {
  pixelRatio?: number
  backgroundColor?: string
  paddingPx?: number
  temporarilyHide?: HTMLElement[]
}

/**
 * Captures a PNG data URL for an HTMLElement using html-to-image, with optional padding and temporarily hidden elements.
 */
export async function captureElementPng(node: HTMLElement, opts: CaptureElementOptions = {}): Promise<string> {
  const { pixelRatio = 2, backgroundColor, paddingPx = 0, temporarilyHide = [] } = opts

  const prevPadding = node.style.padding
  const hiddenPrev: Array<{ el: HTMLElement; vis: string }> = []
  try {
    if (paddingPx > 0) node.style.padding = `${paddingPx}px`
    for (const el of temporarilyHide) {
      hiddenPrev.push({ el, vis: el.style.visibility })
      el.style.visibility = 'hidden'
    }
    const dataUrl = await htmlToImage.toPng(node, { pixelRatio, backgroundColor })
    return dataUrl
  } finally {
    node.style.padding = prevPadding
    for (const { el, vis } of hiddenPrev) {
      el.style.visibility = vis
    }
  }
}

export function downloadDataUrlPng(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}


