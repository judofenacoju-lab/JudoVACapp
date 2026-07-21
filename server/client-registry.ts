import type { ConnectedClient } from '@shared/types/dashboard'

/** Registre des clients LAN — évite les imports circulaires bootstrap ↔ routes. */
const clients = new Map<string, ConnectedClient>()

export const clientRegistry = {
  set(id: string, client: ConnectedClient): void {
    clients.set(id, client)
  },
  get(id: string): ConnectedClient | undefined {
    return clients.get(id)
  },
  delete(id: string): void {
    clients.delete(id)
  },
  list(): ConnectedClient[] {
    return Array.from(clients.values())
  },
  clear(): void {
    clients.clear()
  },
  size(): number {
    return clients.size
  }
}
