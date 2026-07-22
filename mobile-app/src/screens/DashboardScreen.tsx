import { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useAuth } from '../lib/auth-context'
import { getDashboardStats } from '../lib/client'
import { Card, Screen, Subtitle, Title, colors } from '../components/ui'

export function DashboardScreen() {
  const { profile } = useAuth()
  const [total, setTotal] = useState(0)
  const [byUser, setByUser] = useState<Array<{ username: string; count: number }>>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await getDashboardStats()
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setTotal(res.data.totalJudokas)
    setByUser(res.data.judokaByUser)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  return (
    <Screen>
      <ScrollView refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}>
        <Title>Tableau de bord</Title>
        <Subtitle>
          {profile?.role === 'admin' ? 'Admin' : 'Opérateur'} · {profile?.username}
        </Subtitle>
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        <Card>
          <Text style={styles.statLabel}>Judokas</Text>
          <Text style={styles.statValue}>{total}</Text>
          <Text style={styles.statHint}>Stockage · Cloud</Text>
        </Card>
        {profile?.role === 'admin' && (
          <Card>
            <Text style={styles.section}>Judokas par utilisateur</Text>
            {byUser.length === 0 ? (
              <Text style={styles.empty}>Aucun judoka</Text>
            ) : (
              byUser.map((u) => (
                <View key={u.username} style={styles.row}>
                  <Text style={styles.rowName}>{u.username}</Text>
                  <Text style={styles.rowCount}>{u.count}</Text>
                </View>
              ))
            )}
          </Card>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  statLabel: { color: colors.muted, fontSize: 13 },
  statValue: { fontSize: 36, fontWeight: '700', color: colors.navy, marginVertical: 4 },
  statHint: { color: colors.muted, fontSize: 12 },
  section: { fontWeight: '700', color: colors.navy, marginBottom: 10 },
  empty: { color: colors.muted },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  rowName: { color: colors.navy, fontWeight: '600' },
  rowCount: {
    backgroundColor: 'rgba(200,16,46,0.1)',
    color: colors.red,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden'
  }
})
