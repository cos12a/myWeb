export interface ConsoleMessage {
  id: string
  timestamp: number
  direction: 'incoming' | 'outgoing'
  content: string
  type?: 'data' | 'error' | 'info'
}

/**
 * ConsoleStore maintains a fixed-capacity ring buffer of console messages.
 * Similar to RingStore but optimized for string messages with metadata.
 */
export class ConsoleStore {
  private messages: ConsoleMessage[] = []
  private capacity: number = 1000
  private writeIndex: number = 0
  private listeners = new Set<() => void>()
  
  // Cache for getMessages to prevent infinite re-renders
  private cachedMessages: ConsoleMessage[] | null = null
  private cacheVersion: number = 0

  constructor(capacity = 1000) {
    this.capacity = capacity
    this.messages = new Array(capacity)
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.cacheVersion++
    this.cachedMessages = null
    for (const fn of this.listeners) fn()
  }

  addMessage(direction: 'incoming' | 'outgoing', content: string, type: 'data' | 'error' | 'info' = 'data') {
    const message: ConsoleMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      direction,
      content: content.length > 1024 ? content.slice(0, 1024) + '... (truncated)' : content,
      type
    }

    this.messages[this.writeIndex % this.capacity] = message
    this.writeIndex++
    this.emit()
  }

  addIncoming(content: string, type: 'data' | 'error' | 'info' = 'data') {
    this.addMessage('incoming', content, type)
  }

  addOutgoing(content: string, type: 'data' | 'error' | 'info' = 'data') {
    this.addMessage('outgoing', content, type)
  }

  getMessages(): ConsoleMessage[] {
    // Return cached result if available
    if (this.cachedMessages !== null) {
      return this.cachedMessages
    }

    const totalMessages = Math.min(this.writeIndex, this.capacity)
    const result: ConsoleMessage[] = []

    if (totalMessages === 0) {
      this.cachedMessages = result
      return result
    }

    // Calculate the start index in the ring buffer
    const startIndex = this.writeIndex <= this.capacity ? 0 : this.writeIndex % this.capacity

    // If we haven't wrapped around yet, just return the messages in order
    if (this.writeIndex <= this.capacity) {
      this.cachedMessages = this.messages.slice(0, totalMessages)
      return this.cachedMessages
    }

    // We've wrapped around, so we need to get messages in chronological order
    // First get the older messages from startIndex to end of array
    for (let i = startIndex; i < this.capacity; i++) {
      if (this.messages[i]) result.push(this.messages[i])
    }
    
    // Then get the newer messages from start of array to startIndex
    for (let i = 0; i < startIndex; i++) {
      if (this.messages[i]) result.push(this.messages[i])
    }

    this.cachedMessages = result
    return result
  }

  clear() {
    this.messages = new Array(this.capacity)
    this.writeIndex = 0
    this.emit()
  }

  getCapacity() {
    return this.capacity
  }

  setCapacity(capacity: number) {
    if (capacity === this.capacity) return

    // Get current messages in order
    const currentMessages = this.getMessages()
    
    // Keep only the most recent messages that fit in new capacity
    const keepCount = Math.min(currentMessages.length, capacity)
    const messagesToKeep = currentMessages.slice(-keepCount)

    // Create new array and copy messages
    this.messages = new Array(capacity)
    for (let i = 0; i < messagesToKeep.length; i++) {
      this.messages[i] = messagesToKeep[i]
    }

    this.capacity = capacity
    this.writeIndex = messagesToKeep.length
    this.emit()
  }
}