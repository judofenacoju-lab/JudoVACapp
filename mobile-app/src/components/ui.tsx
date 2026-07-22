import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'

export const colors = {
  navy: '#0B1F3A',
  red: '#C8102E',
  muted: '#64748b',
  border: '#e2e8f0',
  bg: '#f8fafc',
  white: '#ffffff',
  danger: '#dc2626',
  ok: '#15803d'
}

export function Screen({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>
}

export function Title({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>
}

export function Subtitle({ children }: { children: string }) {
  return <Text style={styles.subtitle}>{children}</Text>
}

export function Field({
  label,
  ...props
}: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor="#94a3b8" {...props} />
    </View>
  )
}

export function PrimaryButton({
  label,
  onPress,
  disabled
}: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      style={[styles.btn, disabled && styles.btnDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  )
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  title: { fontSize: 22, fontWeight: '700', color: colors.navy, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.muted, marginBottom: 16 },
  field: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: colors.navy, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.white,
    fontSize: 16,
    color: colors.navy
  },
  btn: {
    backgroundColor: colors.red,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.white, fontWeight: '600', fontSize: 16 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12
  }
})
