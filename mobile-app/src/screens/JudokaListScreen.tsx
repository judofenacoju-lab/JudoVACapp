import { useCallback, useState } from 'react'
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { deleteJudoka, listJudokas, type Judoka } from '../lib/client'
import { Card, Screen, Subtitle, Title, colors, PrimaryButton } from '../components/ui'
import type { RootStackParamList } from '../navigation/types'

export function JudokaListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [items, setItems] = useState<Judoka[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await listJudokas()
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setItems(res.data.items)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const filtered = items.filter((j) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [j.lastName, j.firstName, j.displayId, j.club, j.licenseNumber]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })

  return (
    <Screen>
      <Title>Liste / Recherche</Title>
      <Subtitle>{items.length} judoka(s)</Subtitle>
      <PrimaryButton
        label="Nouveau judoka"
        onPress={() => navigation.navigate('JudokaForm', {})}
      />
      <TextInput
        style={styles.search}
        placeholder="Rechercher…"
        value={query}
        onChangeText={setQuery}
        placeholderTextColor="#94a3b8"
      />
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <FlatList
        data={filtered}
        keyExtractor={(j) => j.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item }) => (
          <Card>
            <Pressable onPress={() => navigation.navigate('JudokaForm', { id: item.id, judoka: item })}>
              <Text style={styles.id}>{item.displayId}</Text>
              <Text style={styles.name}>
                {item.firstName} {item.lastName}
              </Text>
              <Text style={styles.meta}>
                {item.category || '—'} · {item.sex}
                {item.weightKg != null ? ` · ${item.weightKg} kg` : ''}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert('Supprimer', `Supprimer ${item.displayId} ?`, [
                  { text: 'Annuler', style: 'cancel' },
                  {
                    text: 'Supprimer',
                    style: 'destructive',
                    onPress: () => {
                      void deleteJudoka(item.id).then(() => void load())
                    }
                  }
                ])
              }
            >
              <Text style={styles.delete}>Supprimer</Text>
            </Pressable>
          </Card>
        )}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.white,
    marginVertical: 12,
    fontSize: 16
  },
  id: { fontSize: 12, color: colors.muted, fontFamily: 'monospace' },
  name: { fontSize: 17, fontWeight: '700', color: colors.navy, marginTop: 2 },
  meta: { color: colors.muted, marginTop: 4 },
  delete: { color: colors.danger, marginTop: 10, fontWeight: '600' }
})
