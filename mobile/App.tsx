import { useCallback, useEffect, useState } from 'react'
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
import { DEFAULT_SERVER_PORT, STORAGE_SERVER_HOST, STORAGE_SERVER_PORT } from './src/types'
import type { BadgeVerifyPayload } from './src/types'
import { parseQrPayload, pingServer, verifyBadge } from './src/api'

type Screen = 'loading' | 'connect' | 'scanner' | 'result' | 'invalid'

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(DEFAULT_SERVER_PORT))
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [badge, setBadge] = useState<BadgeVerifyPayload | null>(null)
  const [invalidMessage, setInvalidMessage] = useState('')
  const [scanned, setScanned] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()

  useEffect(() => {
    void (async () => {
      const savedHost = await AsyncStorage.getItem(STORAGE_SERVER_HOST)
      const savedPort = await AsyncStorage.getItem(STORAGE_SERVER_PORT)
      if (savedHost) {
        setHost(savedHost)
        setPort(savedPort ?? String(DEFAULT_SERVER_PORT))
        setScreen('scanner')
      } else {
        setScreen('connect')
      }
    })()
  }, [])

  const connect = useCallback(async () => {
    const trimmed = host.trim()
    if (!trimmed) {
      setConnectError('Saisissez l’adresse IP du serveur.')
      return
    }
    const portNum = Number(port) || DEFAULT_SERVER_PORT
    setConnecting(true)
    setConnectError(null)
    const ok = await pingServer(trimmed, portNum)
    setConnecting(false)
    if (!ok) {
      setConnectError(
        'Serveur injoignable. Vérifiez l’IP, le port et que le téléphone est sur le même réseau.'
      )
      return
    }
    await AsyncStorage.setItem(STORAGE_SERVER_HOST, trimmed)
    await AsyncStorage.setItem(STORAGE_SERVER_PORT, String(portNum))
    setScanned(false)
    setScreen('scanner')
  }, [host, port])

  const changeServer = useCallback(async () => {
    await AsyncStorage.multiRemove([STORAGE_SERVER_HOST, STORAGE_SERVER_PORT])
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
      const portNum = Number(port) || DEFAULT_SERVER_PORT
      const result = await verifyBadge(host, portNum, parsed)
      if (!result.ok) {
        setInvalidMessage(result.error)
        setScreen('invalid')
        return
      }
      setBadge(result.badge)
      setScreen('result')
    },
    [host, port, scanned]
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
          <Text style={styles.title}>JudoVACapp</Text>
          <Text style={styles.subtitle}>Scanner de badges</Text>
          <Text style={styles.hint}>
            Connectez le téléphone au même réseau Wi‑Fi que le serveur JudoVACapp, puis saisissez
            l’adresse IP affichée dans Configuration → Réseau.
          </Text>
          <Text style={styles.label}>Adresse IP du serveur</Text>
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
          {connectError && <Text style={styles.error}>{connectError}</Text>}
          <Pressable
            style={[styles.button, connecting && styles.buttonDisabled]}
            onPress={() => void connect()}
            disabled={connecting}
          >
            {connecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Se connecter</Text>
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
          Serveur : {host}:{port}
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
        style={[
          styles.rowValue,
          highlight && styles.rowHighlight,
          band && styles.rowBandText
        ]}
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
    fontSize: 13
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
  row: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rowBand: { backgroundColor: '#0B1F3A', borderBottomWidth: 0 },
  rowLabel: { fontSize: 12, color: '#64748b', marginBottom: 2 },
  rowValue: { fontSize: 17, fontWeight: '600', color: '#0B1F3A' },
  rowHighlight: { color: '#C8102E' },
  rowBandText: { color: '#fff' }
})
