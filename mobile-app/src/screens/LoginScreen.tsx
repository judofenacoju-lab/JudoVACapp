import { useState } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useAuth } from '../lib/auth-context'
import { colors, Field, PrimaryButton } from '../components/ui'

export function LoginScreen() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    const res = await signIn(email.trim(), password)
    setBusy(false)
    if (res.error) setError(res.error)
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Image source={require('../../assets/icon.png')} style={styles.logo} />
        <Text style={styles.brand}>JudoVAC-mobile</Text>
        <Text style={styles.tag}>Système complet — mêmes données cloud</Text>

        <View style={styles.form}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="xxxx@mail.com"
          />
          <Field
            label="Mot de passe"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {busy ? (
            <ActivityIndicator color={colors.red} style={{ marginTop: 16 }} />
          ) : (
            <PrimaryButton label="Connexion" onPress={() => void submit()} />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logo: { width: 72, height: 72, borderRadius: 16, alignSelf: 'center', marginBottom: 12 },
  brand: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.white,
    textAlign: 'center'
  },
  tag: { color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 8, marginBottom: 28 },
  form: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20
  },
  error: { color: colors.danger, marginBottom: 8 }
})
