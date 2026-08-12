import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('jvacChrono', {
  appName: 'JVac-Chrono'
})
