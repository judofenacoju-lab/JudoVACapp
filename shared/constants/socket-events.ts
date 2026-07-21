/** Événements Socket.IO (client ↔ serveur LAN). */
export const SocketEvents = {
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  CLIENT_REGISTER: 'client:register',
  CLIENT_REGISTERED: 'client:registered',
  CLIENT_LIST: 'client:list',
  JUDOKA_UPSERT: 'judoka:upsert',
  JUDOKA_UPSERT_ACK: 'judoka:upsert:ack',
  JUDOKA_UPSERT_NACK: 'judoka:upsert:nack',
  JUDOKA_DELETE: 'judoka:delete',
  JUDOKA_DELETE_ACK: 'judoka:delete:ack',
  JUDOKA_DELETE_NACK: 'judoka:delete:nack',
  JUDOKA_UPDATED: 'judoka:updated',
  JUDOKA_DELETED: 'judoka:deleted',
  SYNC_PULL: 'sync:pull',
  SYNC_PUSH: 'sync:push',
  SYNC_STATUS: 'sync:status',
  HEARTBEAT: 'heartbeat',
  HEARTBEAT_ACK: 'heartbeat:ack',
  SERVER_INFO: 'server:info',
  BADGE_TEMPLATE_CHANGED: 'badge:template-changed',
  SETTINGS_CHANGED: 'settings:changed'
} as const

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents]
