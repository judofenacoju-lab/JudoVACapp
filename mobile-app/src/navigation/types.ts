import type { Judoka } from '../lib/client'

export type RootStackParamList = {
  Main: undefined
  JudokaForm: { id?: string; judoka?: Judoka }
}

export type DrawerParamList = {
  Dashboard: undefined
  JudokaList: undefined
  BadgeDesigner: undefined
  PdfExport: undefined
  Backup: undefined
  Admin: undefined
}
