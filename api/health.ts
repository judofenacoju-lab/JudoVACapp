import type { VercelRequest, VercelResponse } from '@vercel/node'

/** Healthcheck pour le ping scanner / mobile. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }
  return res.status(200).json({
    ok: true,
    service: 'judovacapp',
    mode: 'cloud'
  })
}
