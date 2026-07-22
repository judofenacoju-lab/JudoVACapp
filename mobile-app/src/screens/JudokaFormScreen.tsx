import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import {
  createJudoka,
  readPhotoDataUrl,
  updateJudoka,
  uploadPhotoDataUrl
} from '../lib/client'
import { Field, PrimaryButton, Screen, Title, colors } from '../components/ui'
import type { RootStackParamList } from '../navigation/types'

type Props = NativeStackScreenProps<RootStackParamList, 'JudokaForm'>

export function JudokaFormScreen({ route, navigation }: Props) {
  const editing = route.params?.judoka
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photoPath, setPhotoPath] = useState<string | null>(editing?.photoPath ?? null)
  const [preview, setPreview] = useState<string | null>(null)
  const [form, setForm] = useState({
    lastName: editing?.lastName ?? '',
    middleName: editing?.middleName ?? '',
    firstName: editing?.firstName ?? '',
    sex: (editing?.sex ?? 'M') as 'M' | 'F',
    birthDate: editing?.birthDate ?? '2005-01-01',
    club: editing?.club ?? '',
    category: editing?.category ?? '',
    weightKg: editing?.weightKg != null ? String(editing.weightKg) : '',
    licenseNumber: editing?.licenseNumber ?? '',
    phone: editing?.phone ?? '',
    province: editing?.province ?? '',
    city: editing?.city ?? '',
    grade: editing?.grade ?? '',
    belt: editing?.belt ?? ''
  })

  useEffect(() => {
    if (!photoPath) {
      setPreview(null)
      return
    }
    void readPhotoDataUrl(photoPath).then((res) => {
      if (res.ok) setPreview(res.data.dataUrl)
    })
  }, [photoPath])

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function pickPhoto(): Promise<void> {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true
    })
    if (res.canceled || !res.assets[0]?.base64) return
    const asset = res.assets[0]
    const mime = asset.mimeType ?? 'image/jpeg'
    const dataUrl = `data:${mime};base64,${asset.base64}`
    setBusy(true)
    const up = await uploadPhotoDataUrl(dataUrl)
    setBusy(false)
    if (!up.ok) {
      setError(up.error)
      return
    }
    setPhotoPath(up.data.path)
    setPreview(dataUrl)
  }

  async function capturePhoto(): Promise<void> {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      setError('Autorisez la caméra')
      return
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true })
    if (res.canceled || !res.assets[0]?.base64) return
    const asset = res.assets[0]
    const mime = asset.mimeType ?? 'image/jpeg'
    const dataUrl = `data:${mime};base64,${asset.base64}`
    setBusy(true)
    const up = await uploadPhotoDataUrl(dataUrl)
    setBusy(false)
    if (!up.ok) {
      setError(up.error)
      return
    }
    setPhotoPath(up.data.path)
    setPreview(dataUrl)
  }

  async function save(): Promise<void> {
    if (!form.lastName.trim() || !form.firstName.trim()) {
      setError('Nom et prénom requis')
      return
    }
    setBusy(true)
    setError(null)
    const payload = {
      lastName: form.lastName,
      middleName: form.middleName,
      firstName: form.firstName,
      sex: form.sex,
      birthDate: form.birthDate,
      club: form.club,
      category: form.category,
      weightKg: form.weightKg ? Number(form.weightKg) : null,
      licenseNumber: form.licenseNumber,
      phone: form.phone,
      province: form.province,
      city: form.city,
      grade: form.grade,
      belt: form.belt,
      photoPath
    }
    const res = editing
      ? await updateJudoka(editing.id, payload)
      : await createJudoka(payload)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    navigation.goBack()
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Title>{editing ? `Modifier ${editing.displayId}` : 'Nouveau judoka'}</Title>
        <View style={styles.photoBox}>
          {preview ? (
            <Image source={{ uri: preview }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoEmpty]}>
              <Text style={{ color: colors.muted }}>Photo</Text>
            </View>
          )}
          <View style={{ flex: 1, gap: 8 }}>
            <PrimaryButton label="Caméra" onPress={() => void capturePhoto()} disabled={busy} />
            <PrimaryButton label="Importer" onPress={() => void pickPhoto()} disabled={busy} />
          </View>
        </View>
        <Field label="Nom *" value={form.lastName} onChangeText={(v) => set('lastName', v)} />
        <Field label="Postnom" value={form.middleName} onChangeText={(v) => set('middleName', v)} />
        <Field label="Prénom *" value={form.firstName} onChangeText={(v) => set('firstName', v)} />
        <Field
          label="Sexe (M/F)"
          value={form.sex}
          onChangeText={(v) => set('sex', v.toUpperCase().startsWith('F') ? 'F' : 'M')}
          maxLength={1}
        />
        <Field
          label="Date naissance (AAAA-MM-JJ)"
          value={form.birthDate}
          onChangeText={(v) => set('birthDate', v)}
        />
        <Field label="Club" value={form.club} onChangeText={(v) => set('club', v)} />
        <Field label="Catégorie" value={form.category} onChangeText={(v) => set('category', v)} />
        <Field
          label="Poids (kg)"
          value={form.weightKg}
          onChangeText={(v) => set('weightKg', v)}
          keyboardType="decimal-pad"
        />
        <Field
          label="Licence"
          value={form.licenseNumber}
          onChangeText={(v) => set('licenseNumber', v)}
        />
        <Field label="Téléphone" value={form.phone} onChangeText={(v) => set('phone', v)} />
        <Field label="Province" value={form.province} onChangeText={(v) => set('province', v)} />
        <Field label="Ville" value={form.city} onChangeText={(v) => set('city', v)} />
        <Field label="Grade" value={form.grade} onChangeText={(v) => set('grade', v)} />
        <Field label="Ceinture" value={form.belt} onChangeText={(v) => set('belt', v)} />
        {error ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text> : null}
        {busy ? (
          <ActivityIndicator color={colors.red} />
        ) : (
          <PrimaryButton label="Enregistrer" onPress={() => void save()} />
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  photoBox: { flexDirection: 'row', gap: 12, marginBottom: 16, alignItems: 'center' },
  photo: { width: 100, height: 120, borderRadius: 8 },
  photoEmpty: {
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
