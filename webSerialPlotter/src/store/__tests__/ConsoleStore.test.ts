import { describe, it, expect } from 'vitest'
import { ConsoleStore } from '../ConsoleStore'

describe('ConsoleStore', () => {
  it('should cache getMessages results to prevent infinite loops', () => {
    const store = new ConsoleStore(10)
    
    // Add some messages
    store.addIncoming('test1')
    store.addIncoming('test2')
    
    // Get messages twice - should return the same reference
    const messages1 = store.getMessages()
    const messages2 = store.getMessages()
    
    expect(messages1).toBe(messages2) // Same reference
    expect(messages1).toHaveLength(2)
    expect(messages1[0].content).toBe('test1')
    expect(messages1[1].content).toBe('test2')
  })

  it('should invalidate cache when new messages are added', () => {
    const store = new ConsoleStore(10)
    
    store.addIncoming('test1')
    const messages1 = store.getMessages()
    
    store.addIncoming('test2')
    const messages2 = store.getMessages()
    
    expect(messages1).not.toBe(messages2) // Different references
    expect(messages1).toHaveLength(1)
    expect(messages2).toHaveLength(2)
  })

  it('should handle ring buffer wraparound correctly', () => {
    const store = new ConsoleStore(3) // Small capacity
    
    // Fill beyond capacity
    store.addIncoming('msg1')
    store.addIncoming('msg2') 
    store.addIncoming('msg3')
    store.addIncoming('msg4') // This should wrap around
    
    const messages = store.getMessages()
    expect(messages).toHaveLength(3)
    expect(messages[0].content).toBe('msg2') // msg1 got overwritten
    expect(messages[1].content).toBe('msg3')
    expect(messages[2].content).toBe('msg4')
  })

  it('should clear messages and invalidate cache', () => {
    const store = new ConsoleStore(10)
    
    store.addIncoming('test')
    const messages1 = store.getMessages()
    expect(messages1).toHaveLength(1)
    
    store.clear()
    const messages2 = store.getMessages()
    
    expect(messages1).not.toBe(messages2) // Different references
    expect(messages2).toHaveLength(0)
  })

  it('should distinguish between incoming and outgoing messages', () => {
    const store = new ConsoleStore(10)
    
    store.addIncoming('received')
    store.addOutgoing('sent')
    
    const messages = store.getMessages()
    expect(messages).toHaveLength(2)
    expect(messages[0].direction).toBe('incoming')
    expect(messages[0].content).toBe('received')
    expect(messages[1].direction).toBe('outgoing')
    expect(messages[1].content).toBe('sent')
  })

  it('should handle capacity changes correctly', () => {
    const store = new ConsoleStore(5)
    
    // Fill with 5 messages
    for (let i = 1; i <= 5; i++) {
      store.addIncoming(`msg${i}`)
    }
    
    let messages = store.getMessages()
    expect(messages).toHaveLength(5)
    expect(store.getCapacity()).toBe(5)
    
    // Reduce capacity to 3 - should keep only the most recent 3
    store.setCapacity(3)
    messages = store.getMessages()
    
    expect(messages).toHaveLength(3)
    expect(store.getCapacity()).toBe(3)
    expect(messages[0].content).toBe('msg3')
    expect(messages[1].content).toBe('msg4')
    expect(messages[2].content).toBe('msg5')
    
    // Increase capacity to 10 - should work normally
    store.setCapacity(10)
    expect(store.getCapacity()).toBe(10)
    
    // Add more messages to test the new capacity
    store.addIncoming('msg6')
    messages = store.getMessages()
    expect(messages).toHaveLength(4)
  })

  it('should not change capacity if value is the same', () => {
    const store = new ConsoleStore(5)
    store.addIncoming('test')
    
    const messages1 = store.getMessages()
    store.setCapacity(5) // Same capacity
    const messages2 = store.getMessages()
    
    expect(messages1).toBe(messages2) // Should be same reference (cached)
  })
})