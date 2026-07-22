import { useCallback, useState } from 'react'
import { ScrollView, Text } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import {
  getBadgeTemplate,
  setBadgeTemplate
} from '../lib/client'
import type { BadgeTemplate } from '../lib/badge-defaults'
import { Field, PrimaryButton, Screen, Subtitle, Title, colors } from '../components/ui'

export function BadgeDesignerScreen() {
  const [template, setTemplate] = useState<BadgeTemplate | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useFocusEffect(
    useCallback(() => {
      void getBadgeTemplate().then((res) => {
        if (res.ok) setTemplate(res.data)
        else setError(res.error)
      })
    }, [])
  )

  async function save(): Promise<void> {
    if (!template) return
    setBusy(true)
    setError(null)
    const res = await setBadgeTemplate({
      ...template,
      updatedAt: new Date().toISOString()
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setTemplate(res.data)
    setMessage('Badge enregistré — utilisé pour Export PDF')
  }

  if (!template) {
    return (
      <Screen>
        <Text>{error ?? 'Chargement…'}</Text>
      </Screen>
    )
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Title>Designer de badge</Title>
        <Subtitle>
          Format {template.size.widthMm}×{template.size.heightMm} mm · DPI {template.dpi}
        </Subtitle>
        <Field
          label="Largeur (mm)"
          value={String(template.size.widthMm)}
          keyboardType="decimal-pad"
          onChangeText={(v) =>
            setTemplate({
              ...template,
              size: { ...template.size, widthMm: Number(v) || 0 }
            })
          }
        />
        <Field
          label="Hauteur (mm)"
          value={String(template.size.heightMm)}
          keyboardType="decimal-pad"
          onChangeText={(v) =>
            setTemplate({
              ...template,
              size: { ...template.size, heightMm: Number(v) || 0 }
            })
          }
        />
        <Field
          label="Couleur primaire"
          value={template.colors.primary}
          onChangeText={(v) =>
            setTemplate({ ...template, colors: { ...template.colors, primary: v } })
          }
        />
        <Field
          label="Couleur secondaire (poids)"
          value={template.colors.secondary}
          onChangeText={(v) =>
            setTemplate({ ...template, colors: { ...template.colors, secondary: v } })
          }
        />
        <Field
          label="Couleur bandeau"
          value={template.colors.band}
          onChangeText={(v) =>
            setTemplate({ ...template, colors: { ...template.colors, band: v } })
          }
        />
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {message ? <Text style={{ color: colors.ok }}>{message}</Text> : null}
        <PrimaryButton
          label={busy ? 'Enregistrement…' : 'Enregistrer le badge'}
          onPress={() => void save()}
          disabled={busy}
        />
      </ScrollView>
    </Screen>
  )
}
