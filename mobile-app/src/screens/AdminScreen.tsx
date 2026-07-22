import { useCallback, useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useAuth } from '../lib/auth-context'
import { createUser, listUsers } from '../lib/client'
import { Field, PrimaryButton, Screen, Subtitle, Title, colors, Card } from '../components/ui'

export function AdminScreen() {
  const { profile } = useAuth()
  const [items, setItems] = useState<
    Array<{ id: string; username: string; role: string; active: boolean }>
  >([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await listUsers()
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

  if (profile?.role !== 'admin') {
    return (
      <Screen>
        <Title>Configuration</Title>
        <Text style={{ color: colors.danger }}>Accès admin requis</Text>
      </Screen>
    )
  }

  async function create(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    const res = await createUser({
      email: email.trim(),
      password,
      username: username.trim(),
      role: 'operator'
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setEmail('')
    setPassword('')
    setUsername('')
    setMessage('Utilisateur créé')
    await load()
  }

  return (
    <Screen>
      <Title>Configuration</Title>
      <Subtitle>Utilisateurs (admin)</Subtitle>
      <Card>
        <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry />
        <PrimaryButton
          label={busy ? '…' : 'Créer opérateur'}
          onPress={() => void create()}
          disabled={busy}
        />
      </Card>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      {message ? <Text style={{ color: colors.ok }}>{message}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(u) => u.id}
        renderItem={({ item }) => (
          <Card>
            <Text style={{ fontWeight: '700', color: colors.navy }}>{item.username}</Text>
            <Text style={{ color: colors.muted }}>
              {item.role} · {item.active ? 'actif' : 'inactif'}
            </Text>
          </Card>
        )}
      />
    </Screen>
  )
}
