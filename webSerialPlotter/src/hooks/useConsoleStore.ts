import { useSyncExternalStore } from 'react'
import { ConsoleStore } from '../store/ConsoleStore'

let consoleStoreInstance: ConsoleStore | null = null

function getConsoleStore(): ConsoleStore {
  if (!consoleStoreInstance) {
    consoleStoreInstance = new ConsoleStore(1000) // Default 1000 messages
  }
  return consoleStoreInstance
}

export function useConsoleStore() {
  const store = getConsoleStore()
  
  const messages = useSyncExternalStore(
    (callback) => store.subscribe(callback),
    () => store.getMessages(),
    () => []
  )

  return {
    messages,
    addIncoming: (content: string, type?: 'data' | 'error' | 'info') => store.addIncoming(content, type),
    addOutgoing: (content: string, type?: 'data' | 'error' | 'info') => store.addOutgoing(content, type),
    clear: () => store.clear(),
    getCapacity: () => store.getCapacity(),
    setCapacity: (capacity: number) => store.setCapacity(capacity)
  }
}