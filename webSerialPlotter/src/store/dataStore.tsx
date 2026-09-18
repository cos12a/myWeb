/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useRef, useSyncExternalStore } from 'react'
import { RingStore } from './RingStore'

const StoreContext = createContext<RingStore | null>(null)

export function DataStoreProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<RingStore | null>(null)
  if (!storeRef.current) storeRef.current = new RingStore(100000, 200)
  const value = storeRef.current
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useDataStore() {
  const store = useContext(StoreContext)
  if (!store) throw new Error('DataStoreProvider missing')
  const getSnapshot = () => store.getVersion()
  const subscribe = (cb: () => void) => store.subscribe(cb)
  useSyncExternalStore(subscribe, getSnapshot, () => 0)
  return store
}


