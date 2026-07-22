import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * L’export PDF est généré côté navigateur (pdf-lib) pour éviter
 * les crashes PDFKit sur Vercel (FUNCTION_INVOCATION_FAILED).
 * Cette route reste un healthcheck / message d’orientation.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'pdf-export',
      mode: 'client-side'
    })
  }

  if (req.method === 'POST') {
    return res.status(410).json({
      ok: false,
      error:
        'Export PDF déplacé côté navigateur. Mettez à jour l’application (rechargez la page).'
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
