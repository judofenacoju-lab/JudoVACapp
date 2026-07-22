import 'react-native-gesture-handler'
import { ActivityIndicator, View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { StatusBar } from 'expo-status-bar'
import { AuthProvider, useAuth } from './src/lib/auth-context'
import { LoginScreen } from './src/screens/LoginScreen'
import { AppNavigator } from './src/navigation/RootNavigator'
import { colors } from './src/components/ui'

function Root() {
  const { profile, loading } = useAuth()
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.red} />
      </View>
    )
  }
  if (!profile) return <LoginScreen />
  return (
    <NavigationContainer>
      <AppNavigator />
    </NavigationContainer>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Root />
    </AuthProvider>
  )
}
