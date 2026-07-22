import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { StatusBar } from 'expo-status-bar'
import { CameraView, useCameraPermissions } from 'expo-camera'
import {
  DEFAULT_CLOUD_BASE_URL,
  DEFAULT_SERVER_PORT,
  STORAGE_CLOUD_URL,
  STORAGE_MODE,
  STORAGE_SERVER_HOST,
  STORAGE_SERVER_PORT,
  type BadgeVerifyPayload,
  type ServerMode
} from './src/types'
import { buildBaseUrl, parseQrPayload, pingServer, verifyBadge } from './src/api'

type Screen = 'loading' | 'connect' | 'scanner' | 'result' | 'invalid'

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [mode, setMode] = useState<ServerMode>('cloud')
  const [cloudUrl, setCloudUrl] = useState(DEFAULT_CLOUD_BASE_URL)
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(DEFAULT_SERVER_PORT))
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [badge, setBadge] = useState<BadgeVerifyPayload | null>(null)
  const [invalidMessage, setInvalidMessage] = useState('')
  const [scanned, setScanned] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()

  const baseUrl = useMemo(
    () =>
      buildBaseUrl({
        mode,
        cloudUrl,
        host,
        port: Number(port) || DEFAULT_SERVER_PORT
      }),
    [mode, cloudUrl, host, port]
  )

  useEffect(() => {
    void (async () => {
      const savedMode = (await AsyncStorage.getItem(STORAGE_MODE)) as ServerMode | null
      const savedCloud = await AsyncStorage.getItem(STORAGE_CLOUD_URL)
      const savedHost = await AsyncStorage.getItem(STORAGE_SERVER_HOST)
      const savedPort = await AsyncStorage.getItem(STORAGE_SERVER_PORT)

      if (savedCloud) setCloudUrl(savedCloud)
      if (savedHost) setHost(savedHost)
      if (savedPort) setPort(savedPort)

      if (savedMode === 'local' || savedMode === 'cloud') {
        setMode(savedMode)
        setScreen('scanner')
        return
      }

      // Premier lancement : cloud par défaut, ping auto
      const url = buildBaseUrl({ mode: 'cloud', cloudUrl: savedCloud || DEFAULT_CLOUD_BASE_URL })
      const ok = await pingServer(url)
      if (ok) {
        await AsyncStorage.setItem(STORAGE_MODE, 'cloud')
        await AsyncStorage.setItem(STORAGE_CLOUD_URL, savedCloud || DEFAULT_CLOUD_BASE_URL)
        setMode('cloud')
        setScreen('scanner')
      } else {
        setScreen('connect')
      }
    })()
  }, [])

  const connect = useCallback(async () => {
    setConnecting(true)
    setConnectError(null)
    const url = buildBaseUrl({
      mode,
      cloudUrl,
      host,
      port: Number(port) || DEFAULT_SERVER_PORT
    })
    if (mode === 'local' && !host.trim()) {
      setConnecting(false)
      setConnectError('Saisissez l’adresse IP du serveur local.')
      return
    }
    const ok = await pingServer(url)
    setConnecting(false)
    if (!ok) {
      setConnectError(
        mode === 'cloud'
          ? 'Cloud injoignable. Vérifiez Internet ou l’URL Vercel.'
          : 'Serveur local injoignable. Vérifiez IP, port et Wi‑Fi.'
      )
      return
    }
    await AsyncStorage.setItem(STORAGE_MODE, mode)
    await AsyncStorage.setItem(STORAGE_CLOUD_URL, cloudUrl.trim() || DEFAULT_CLOUD_BASE_URL)
    await AsyncStorage.setItem(STORAGE_SERVER_HOST, host.trim())
    await AsyncStorage.setItem(STORAGE_SERVER_PORT, String(Number(port) || DEFAULT_SERVER_PORT))
    setScanned(false)
    setScreen('scanner')
  }, [mode, cloudUrl, host, port])

  const changeServer = useCallback(async () => {
    setScreen('connect')
    setBadge(null)
    setScanned(false)
  }, [])

  const handleScan = useCallback(
    async (data: string) => {
      if (scanned) return
      setScanned(true)
      const parsed = parseQrPayload(data)
      if (!parsed) {
        setInvalidMessage('QR code non reconnu.')
        setScreen('invalid')
        return
      }
      const result = await verifyBadge(baseUrl, parsed)
      if (!result.ok) {
        setInvalidMessage(result.error)
        setScreen('invalid')
        return
      }
      setBadge(result.badge)
      setScreen('result')
    },
    [baseUrl, scanned]
  )

  const scanAgain = useCallback(() => {
    setScanned(false)
    setBadge(null)
    setInvalidMessage('')
    setScreen('scanner')
  }, [])

  if (screen === 'loading') {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#C8102E" />
        <StatusBar style="dark" />
      </SafeAreaView>
    )
  }

  if (screen === 'connect') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.connectBox}>
          <Text style={styles.title}>JudoVACapp Scanner</Text>
          <Text style={styles.subtitle}>Authentification des badges QR</Text>

          <View style={styles.modeRow}>
            <Pressable
              style={[styles.modeBtn, mode === 'cloud' && styles.modeBtnActive]}
              onPress={() => setMode('cloud')}
            >
              <Text style={[styles.modeText, mode === 'cloud' && styles.modeTextActive]}>Cloud</Text>
            </Pressable>
            <Pressable
              style={[styles.modeBtn, mode === 'local' && styles.modeBtnActive]}
              onPress={() => setMode('local')}
            >
              <Text style={[styles.modeText, mode === 'local' && styles.modeTextActive]}>
                Serveur local
              </Text>
            </Pressable>
          </View>

          {mode === 'cloud' ? (
            <>
              <Text style={styles.hint}>
                Connecté aux badges enregistrés en ligne (Supabase / Vercel).
              </Text>
              <Text style={styles.label}>URL cloud</Text>
              <TextInput
                style={styles.input}
                value={cloudUrl}
                onChangeText={setCloudUrl}
                placeholder={DEFAULT_CLOUD_BASE_URL}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                Même Wi‑Fi que le PC serveur Electron — IP dans Configuration → Réseau.
              </Text>
              <Text style={styles.label}>Adresse IP</Text>
              <TextInput
                style={styles.input}
                value={host}
                onChangeText={setHost}
                placeholder="192.168.1.10"
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.label}>Port</Text>
              <TextInput
                style={styles.input}
                value={port}
                onChangeText={setPort}
                keyboardType="number-pad"
              />
            </>
          )}

          {connectError && <Text style={styles.error}>{connectError}</Text>}
          <Pressable
            style={[styles.button, connecting && styles.buttonDisabled]}
            onPress={() => void connect()}
            disabled={connecting}
          >
            {connecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Continuer</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  if (screen === 'result' && badge) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.resultBox}>
          <Text style={styles.validTitle}>Badge authentifié</Text>
          <View style={styles.card}>
            <Row label="Nom" value={badge.fullName} />
            <Row label="Catégorie" value={badge.category} />
            {badge.weight ? <Row label="Poids" value={badge.weight} highlight /> : null}
            <Row label="Sexe" value={badge.sex} />
            <Row label="N° badge" value={badge.displayId} band />
          </View>
          <Pressable style={styles.button} onPress={scanAgain}>
            <Text style={styles.buttonText}>Scanner un autre badge</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => void changeServer()}>
            <Text style={styles.linkText}>Changer de serveur</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  if (screen === 'invalid') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.resultBox}>
          <Text style={styles.invalidTitle}>Badge non valide</Text>
          <Text style={styles.invalidText}>{invalidMessage}</Text>
          <Pressable style={styles.button} onPress={scanAgain}>
            <Text style={styles.buttonText}>Réessayer</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  if (!permission) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#C8102E" />
      </SafeAreaView>
    )
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.connectBox}>
          <Text style={styles.subtitle}>Accès caméra requis pour scanner les QR codes.</Text>
          <Pressable style={styles.button} onPress={() => void requestPermission()}>
            <Text style={styles.buttonText}>Autoriser la caméra</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.scannerSafe}>
      <StatusBar style="light" />
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : ({ data }) => void handleScan(data)}
      />
      <View style={styles.scannerOverlay}>
        <Text style={styles.scannerTitle}>Scanner le QR du badge</Text>
        <Text style={styles.scannerHost}>
          {mode === 'cloud' ? 'Cloud' : 'Local'} · {baseUrl.replace(/^https?:\/\//, '')}
        </Text>
        <View style={styles.scannerFrame} />
        <Pressable style={styles.linkButtonLight} onPress={() => void changeServer()}>
          <Text style={styles.linkTextLight}>Changer de serveur</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

function Row({
  label,
  value,
  highlight,
  band
}: {
  label: string
  value: string
  highlight?: boolean
  band?: boolean
}) {
  return (
    <View style={[styles.row, band && styles.rowBand]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, highlight && styles.rowHighlight, band && styles.rowBandText]}
      >
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  scannerSafe: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  connectBox: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: '#0B1F3A', textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#64748b', textAlign: 'center', marginTop: 8, marginBottom: 24 },
  hint: { fontSize: 14, color: '#64748b', lineHeight: 20, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#0B1F3A', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 16,
    backgroundColor: '#f8fafc'
  },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  modeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#f8fafc'
  },
  modeBtnActive: { backgroundColor: '#0B1F3A', borderColor: '#0B1F3A' },
  modeText: { color: '#0B1F3A', fontWeight: '600' },
  modeTextActive: { color: '#fff' },
  button: {
    backgroundColor: '#C8102E',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#dc2626', fontSize: 14, marginBottom: 8 },
  camera: { flex: 1 },
  scannerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  scannerTitle: {
    position: 'absolute',
    top: 48,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600'
  },
  scannerHost: {
    position: 'absolute',
    top: 80,
    color: '#e2e8f0',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 16
  },
  scannerFrame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: '#C8102E',
    borderRadius: 16,
    backgroundColor: 'transparent'
  },
  linkButton: { marginTop: 16, alignItems: 'center' },
  linkButtonLight: { position: 'absolute', bottom: 48, alignItems: 'center' },
  linkText: { color: '#0B1F3A', fontSize: 14 },
  linkTextLight: { color: '#fff', fontSize: 14 },
  resultBox: { flex: 1, padding: 24, justifyContent: 'center' },
  validTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#15803d',
    textAlign: 'center',
    marginBottom: 20
  },
  invalidTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#dc2626',
    textAlign: 'center',
    marginBottom: 12
  },
  invalidText: { fontSize: 15, color: '#64748b', textAlign: 'center', marginBottom: 24 },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9'
  },
  rowBand: { backgroundColor: '#0B1F3A', borderBottomWidth: 0 },
  rowLabel: { fontSize: 12, color: '#64748b', marginBottom: 2 },
  rowValue: { fontSize: 17, fontWeight: '600', color: '#0B1F3A' },
  rowHighlight: { color: '#C8102E' },
  rowBandText: { color: '#fff' }
})
