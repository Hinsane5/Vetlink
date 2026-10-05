import { createContext, useContext, type ReactNode } from 'react';
import type { LocalStore } from '../data/local/sqlite/LocalStore';

const LocalStoreContext = createContext<LocalStore | null>(null);

export function LocalStoreProvider({ store, children }: { store: LocalStore; children: ReactNode }) {
  return <LocalStoreContext.Provider value={store}>{children}</LocalStoreContext.Provider>;
}

export function useLocalStore(): LocalStore {
  const store = useContext(LocalStoreContext);
  if (!store) throw new Error('LocalStoreProvider belum tersedia pada root aplikasi.');
  return store;
}
