import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import net from 'node:net'

const execFileAsync = promisify(execFile)

/**
 * Vérifie qu'un port TCP est libre ; tente de libérer les processus
 * qui l'occupent (souvent une ancienne instance Electron / Node).
 */
export async function ensurePortAvailable(port: number): Promise<void> {
  if (await isPortFree(port)) return

  const pids = await findPidsOnPort(port)
  const self = process.pid
  for (const pid of pids) {
    if (pid === self || pid <= 0) continue
    try {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/PID', String(pid), '/F', '/T'])
      } else {
        process.kill(pid, 'SIGTERM')
      }
      console.warn(`[JudoVACapp] Processus ${pid} arrêté — port ${port} libéré`)
    } catch (err) {
      console.warn(`[JudoVACapp] Impossible d'arrêter PID ${pid}:`, err)
    }
  }

  for (let i = 0; i < 10; i++) {
    if (await isPortFree(port)) return
    await sleep(200)
  }

  throw new Error(
    `Le port ${port} est déjà utilisé. Fermez l'autre instance de JudoVACapp puis réessayez.`
  )
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true))
    })
  })
}

async function findPidsOnPort(port: number): Promise<number[]> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'TCP'])
      const pids = new Set<number>()
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) continue
        if (!/LISTENING/i.test(line)) continue
        const parts = line.trim().split(/\s+/)
        const pid = Number(parts[parts.length - 1])
        if (Number.isFinite(pid) && pid > 0) pids.add(pid)
      }
      return [...pids]
    } catch {
      return []
    }
  }

  try {
    const { stdout } = await execFileAsync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'])
    return stdout
      .split(/\s+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  } catch {
    return []
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
