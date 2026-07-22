import { useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import {
  getBadgeTemplate,
  listJudokas,
  readPhotoDataUrl
} from '../lib/client'
import { buildBadgesPdf } from '../lib/badge-pdf'
import { PrimaryButton, Screen, Subtitle, Title, colors } from '../components/ui'

export function PdfExportScreen() {
  const [perPage, setPerPage] = useState<4 | 6 | 8>(4)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function exportPdf(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const [tmpl, list] = await Promise.all([getBadgeTemplate(), listJudokas()])
      if (!tmpl.ok) throw new Error(tmpl.error)
      if (!list.ok) throw new Error(list.error)

      const photoDataUrls: Record<string, string | null> = {}
      for (const j of list.data.items) {
        if (!j.photoPath) continue
        const res = await readPhotoDataUrl(j.photoPath)
        photoDataUrls[j.photoPath] = res.ok ? res.data.dataUrl : null
      }

      let logoDataUrl: string | null = null
      if (tmpl.data.logoPath) {
        const logo = await readPhotoDataUrl(tmpl.data.logoPath)
        if (logo.ok) logoDataUrl = logo.data.dataUrl
      }

      const bytes = await buildBadgesPdf({
        template: tmpl.data,
        judokas: list.data.items,
        photoDataUrls,
        logoDataUrl,
        perPage
      })

      const filename = `badges-${new Date().toISOString().slice(0, 10)}.pdf`
      const path = `${FileSystem.cacheDirectory}${filename}`
      const base64 = uint8ToBase64(bytes)
      await FileSystem.writeAsStringAsync(path, base64, {
        encoding: FileSystem.EncodingType.Base64
      })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: 'application/pdf',
          dialogTitle: 'Exporter / Imprimer badges'
        })
      }
      setMessage(`${list.data.items.length} badge(s) généré(s). Partagez ou imprimez le PDF.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>Export / Impression PDF</Title>
      <Subtitle>Génère un PDF partageable (mêmes données cloud)</Subtitle>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        {([4, 6, 8] as const).map((n) => (
          <PrimaryButton
            key={n}
            label={`${n}/page`}
            onPress={() => setPerPage(n)}
            disabled={busy}
          />
        ))}
      </View>
      <Text style={{ marginBottom: 8, color: colors.muted }}>Disposition : {perPage} / page</Text>
      {busy ? (
        <ActivityIndicator color={colors.red} />
      ) : (
        <PrimaryButton label="Générer le PDF" onPress={() => void exportPdf()} />
      )}
      {error ? <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text> : null}
      {message ? <Text style={{ color: colors.ok, marginTop: 12 }}>{message}</Text> : null}
    </Screen>
  )
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
