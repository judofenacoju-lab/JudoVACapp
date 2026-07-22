import { useState } from 'react'
import { Text } from 'react-native'
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as DocumentPicker from 'expo-document-picker'
import { exportBackupJson } from '../lib/client'
import { supabase } from '../lib/supabase'
import { PrimaryButton, Screen, Subtitle, Title, colors } from '../components/ui'

export function BackupScreen() {
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function exportBackup(): Promise<void> {
    setBusy(true)
    setError(null)
    const res = await exportBackupJson()
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const path = `${FileSystem.cacheDirectory}${res.data.filename}`
    await FileSystem.writeAsStringAsync(path, res.data.json)
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: 'application/json' })
    }
    setMessage('Sauvegarde exportée')
  }

  async function importBackup(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true
      })
      if (pick.canceled || !pick.assets?.[0]) {
        setBusy(false)
        return
      }
      const text = await FileSystem.readAsStringAsync(pick.assets[0].uri)
      const data = JSON.parse(text) as { judokas?: Record<string, unknown>[] }
      const judokas = data.judokas ?? []
      let added = 0
      for (const row of judokas) {
        const { error: err } = await supabase.from('judokas').upsert(row)
        if (!err) added++
      }
      setMessage(`Import : ${added} judoka(s)`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>Sauvegarde</Title>
      <Subtitle>Export / import JSON (cloud)</Subtitle>
      <PrimaryButton
        label={busy ? '…' : 'Exporter la sauvegarde'}
        onPress={() => void exportBackup()}
        disabled={busy}
      />
      <PrimaryButton
        label="Importer une sauvegarde"
        onPress={() => void importBackup()}
        disabled={busy}
      />
      {error ? <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text> : null}
      {message ? <Text style={{ color: colors.ok, marginTop: 12 }}>{message}</Text> : null}
    </Screen>
  )
}
