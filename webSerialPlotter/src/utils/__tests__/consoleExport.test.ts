import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportMessagesAsTxt, exportMessagesAsCsv, exportMessagesAsJson, downloadFile, formatTimestamp } from '../consoleExport'
import type { ConsoleMessage } from '../../store/ConsoleStore'

const mockMessages: ConsoleMessage[] = [
  {
    id: '1',
    timestamp: 1609459200000, // 2021-01-01 00:00:00 UTC
    direction: 'incoming',
    content: 'Hello, world!',
    type: 'data'
  },
  {
    id: '2',
    timestamp: 1609459260000, // 2021-01-01 00:01:00 UTC
    direction: 'outgoing',
    content: 'status',
    type: 'data'
  },
  {
    id: '3',
    timestamp: 1609459320000, // 2021-01-01 00:02:00 UTC
    direction: 'incoming',
    content: 'Device ready',
    type: 'info'
  },
  {
    id: '4',
    timestamp: 1609459380000, // 2021-01-01 00:03:00 UTC
    direction: 'incoming',
    content: 'Connection failed',
    type: 'error'
  }
]

describe('consoleExport', () => {
  describe('formatTimestamp', () => {
    it('should format timestamp as ISO string', () => {
      const result = formatTimestamp(1609459200000)
      expect(result).toBe('2021-01-01T00:00:00.000Z')
    })
  })

  describe('exportMessagesAsTxt', () => {
    it('should export messages in text format', () => {
      const result = exportMessagesAsTxt(mockMessages)
      const lines = result.split('\n')
      
      expect(lines).toHaveLength(4)
      expect(lines[0]).toBe('2021-01-01T00:00:00.000Z ← Hello, world!')
      expect(lines[1]).toBe('2021-01-01T00:01:00.000Z → status')
      expect(lines[2]).toBe('2021-01-01T00:02:00.000Z ← [INFO] Device ready')
      expect(lines[3]).toBe('2021-01-01T00:03:00.000Z ← [ERROR] Connection failed')
    })

    it('should handle empty messages array', () => {
      const result = exportMessagesAsTxt([])
      expect(result).toBe('')
    })
  })

  describe('exportMessagesAsCsv', () => {
    it('should export messages in CSV format with header', () => {
      const result = exportMessagesAsCsv(mockMessages)
      const lines = result.split('\n')
      
      expect(lines[0]).toBe('Timestamp,Direction,Type,Content')
      expect(lines[1]).toBe('2021-01-01T00:00:00.000Z,incoming,data,"Hello, world!"')
      expect(lines[2]).toBe('2021-01-01T00:01:00.000Z,outgoing,data,"status"')
      expect(lines[3]).toBe('2021-01-01T00:02:00.000Z,incoming,info,"Device ready"')
      expect(lines[4]).toBe('2021-01-01T00:03:00.000Z,incoming,error,"Connection failed"')
    })

    it('should escape quotes in CSV content', () => {
      const messageWithQuotes: ConsoleMessage = {
        id: '1',
        timestamp: 1609459200000,
        direction: 'incoming',
        content: 'Message with "quotes" inside',
        type: 'data'
      }
      
      const result = exportMessagesAsCsv([messageWithQuotes])
      const lines = result.split('\n')
      
      expect(lines[1]).toBe('2021-01-01T00:00:00.000Z,incoming,data,"Message with ""quotes"" inside"')
    })
  })

  describe('exportMessagesAsJson', () => {
    it('should export messages in JSON format', () => {
      const result = exportMessagesAsJson(mockMessages)
      const parsed = JSON.parse(result)
      
      expect(parsed).toHaveProperty('exported')
      expect(parsed.messageCount).toBe(4)
      expect(parsed.messages).toHaveLength(4)
      
      expect(parsed.messages[0]).toEqual({
        timestamp: 1609459200000,
        timestampISO: '2021-01-01T00:00:00.000Z',
        direction: 'incoming',
        type: 'data',
        content: 'Hello, world!'
      })
      
      expect(parsed.messages[2]).toEqual({
        timestamp: 1609459320000,
        timestampISO: '2021-01-01T00:02:00.000Z',
        direction: 'incoming',
        type: 'info',
        content: 'Device ready'
      })
    })

    it('should handle messages without type', () => {
      const messageNoType: ConsoleMessage = {
        id: '1',
        timestamp: 1609459200000,
        direction: 'incoming',
        content: 'No type message'
      }
      
      const result = exportMessagesAsJson([messageNoType])
      const parsed = JSON.parse(result)
      
      expect(parsed.messages[0].type).toBe('data')
    })
  })

  describe('downloadFile', () => {
    beforeEach(() => {
      // Mock DOM methods
      global.URL.createObjectURL = vi.fn(() => 'mock-url')
      global.URL.revokeObjectURL = vi.fn()
      
      // Mock document methods
      const mockLink = {
        href: '',
        download: '',
        click: vi.fn()
      }
      
      vi.spyOn(document, 'createElement').mockReturnValue(mockLink as HTMLAnchorElement)
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as Node)
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as Node)
    })

    it('should create download link and trigger download', () => {
      downloadFile('test content', 'test.txt', 'text/plain')
      
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(
        expect.any(Blob)
      )
      expect(document.createElement).toHaveBeenCalledWith('a')
      expect(document.body.appendChild).toHaveBeenCalled()
      expect(document.body.removeChild).toHaveBeenCalled()
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('mock-url')
    })
  })
})