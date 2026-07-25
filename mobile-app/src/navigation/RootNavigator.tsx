import { Pressable, Text } from 'react-native'
import { createDrawerNavigator, DrawerContentScrollView, DrawerItem } from '@react-navigation/drawer'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useAuth } from '../lib/auth-context'
import { DashboardScreen } from '../screens/DashboardScreen'
import { JudokaListScreen } from '../screens/JudokaListScreen'
import { JudokaFormScreen } from '../screens/JudokaFormScreen'
import { BadgeDesignerScreen } from '../screens/BadgeDesignerScreen'
import { PdfExportScreen } from '../screens/PdfExportScreen'
import { BackupScreen } from '../screens/BackupScreen'
import { AdminScreen } from '../screens/AdminScreen'
import { colors } from '../components/ui'
import type { DrawerParamList, RootStackParamList } from './types'

const Drawer = createDrawerNavigator<DrawerParamList>()
const Stack = createNativeStackNavigator<RootStackParamList>()

function MainDrawer() {
  const { profile, signOut } = useAuth()
  return (
    <Drawer.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.navy },
        headerTintColor: '#fff',
        drawerActiveTintColor: colors.red,
        // Tablettes : éviter drawer permanent qui laisse l'écran vide
        drawerType: 'front',
        overlayColor: 'rgba(0,0,0,0.45)',
        swipeEnabled: true
      }}
      drawerContent={(props) => (
        <DrawerContentScrollView {...props}>
          <Text style={{ padding: 16, fontWeight: '700', color: colors.navy }}>
            {profile?.username} ({profile?.role})
          </Text>
          <DrawerItem label="Tableau de bord" onPress={() => props.navigation.navigate('Dashboard')} />
          <DrawerItem label="Liste / Judokas" onPress={() => props.navigation.navigate('JudokaList')} />
          <DrawerItem
            label="Designer badge"
            onPress={() => props.navigation.navigate('BadgeDesigner')}
          />
          <DrawerItem label="Export PDF" onPress={() => props.navigation.navigate('PdfExport')} />
          <DrawerItem label="Sauvegarde" onPress={() => props.navigation.navigate('Backup')} />
          {profile?.role === 'admin' && (
            <DrawerItem label="Configuration" onPress={() => props.navigation.navigate('Admin')} />
          )}
          <Pressable onPress={() => void signOut()} style={{ padding: 16 }}>
            <Text style={{ color: colors.danger, fontWeight: '600' }}>Déconnexion</Text>
          </Pressable>
        </DrawerContentScrollView>
      )}
    >
      <Drawer.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Tableau de bord' }} />
      <Drawer.Screen name="JudokaList" component={JudokaListScreen} options={{ title: 'Judokas' }} />
      <Drawer.Screen
        name="BadgeDesigner"
        component={BadgeDesignerScreen}
        options={{ title: 'Designer badge' }}
      />
      <Drawer.Screen name="PdfExport" component={PdfExportScreen} options={{ title: 'Export PDF' }} />
      <Drawer.Screen name="Backup" component={BackupScreen} options={{ title: 'Sauvegarde' }} />
      <Drawer.Screen name="Admin" component={AdminScreen} options={{ title: 'Configuration' }} />
    </Drawer.Navigator>
  )
}

export function AppNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Main" component={MainDrawer} options={{ headerShown: false }} />
      <Stack.Screen
        name="JudokaForm"
        component={JudokaFormScreen}
        options={{ title: 'Judoka', headerStyle: { backgroundColor: colors.navy }, headerTintColor: '#fff' }}
      />
    </Stack.Navigator>
  )
}
