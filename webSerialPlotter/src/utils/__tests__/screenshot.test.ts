import { describe, it, expect, vi } from 'vitest'
import { captureElementPng, downloadDataUrlPng } from '../screenshot'

vi.mock('html-to-image', () => ({
  toPng: vi.fn(async () => 'data:image/png;base64,AAA')
}))

describe('screenshot utils', () => {
  it('captureElementPng applies padding and hides elements during capture', async () => {
    const node = document.createElement('div')
    const hide = document.createElement('div')
    hide.style.visibility = 'visible'
    const url = await captureElementPng(node, { paddingPx: 10, temporarilyHide: [hide] })
    expect(url.startsWith('data:image/png')).toBe(true)
    expect(hide.style.visibility).toBe('visible')
    expect(node.style.padding).toBe('')
  })

  it('downloadDataUrlPng triggers a download link', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadDataUrlPng('data:image/png;base64,AAA', 'file.png')
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })
})


