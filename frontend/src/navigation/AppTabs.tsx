import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { HomeScreen } from '../screens/HomeScreen';
import { TransactionsScreen } from '../screens/TransactionsScreen';
import { SMSImportScreen } from '../screens/SMSImportScreen';
import { ReceiptsScreen } from '../screens/ReceiptsScreen';
import { ReceiptUploadScreen } from '../screens/ReceiptUploadScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { colors } from '../theme';

// ─── Param lists ─────────────────────────────────────────────────────────────

export type AppTabParamList = {
  HomeTab: undefined;
  TransactionsTab: undefined;
  ReceiptsTab: undefined;
  ProfileTab: undefined;
};

export type TransactionsStackParamList = {
  TransactionsList: undefined;
  SMSImport: undefined;
};

export type ReceiptsStackParamList = {
  ReceiptsList: undefined;
  ReceiptUpload: undefined;
};

// ─── Nested stacks ───────────────────────────────────────────────────────────

const TxStack = createNativeStackNavigator<TransactionsStackParamList>();

function TransactionsStack() {
  return (
    <TxStack.Navigator
      screenOptions={{ headerTintColor: colors.primary, headerBackTitle: '' }}
    >
      <TxStack.Screen
        name="TransactionsList"
        component={TransactionsScreen}
        options={{ title: 'Transactions' }}
      />
      <TxStack.Screen
        name="SMSImport"
        component={SMSImportScreen}
        options={{ title: 'Import SMS' }}
      />
    </TxStack.Navigator>
  );
}

const RxStack = createNativeStackNavigator<ReceiptsStackParamList>();

function ReceiptsStack() {
  return (
    <RxStack.Navigator
      screenOptions={{ headerTintColor: colors.primary, headerBackTitle: '' }}
    >
      <RxStack.Screen
        name="ReceiptsList"
        component={ReceiptsScreen}
        options={{ title: 'Receipts' }}
      />
      <RxStack.Screen
        name="ReceiptUpload"
        component={ReceiptUploadScreen}
        options={{ title: 'Upload Receipt' }}
      />
    </RxStack.Navigator>
  );
}

// ─── Bottom tabs ─────────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<AppTabParamList>();

export function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { borderTopColor: colors.border },
        tabBarIcon: ({ color, size }) => {
          const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
            HomeTab: 'home-outline',
            TransactionsTab: 'list-outline',
            ReceiptsTab: 'receipt-outline',
            ProfileTab: 'person-outline',
          };
          return <Ionicons name={icons[route.name] ?? 'ellipse-outline'} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen name="TransactionsTab" component={TransactionsStack} options={{ title: 'Transactions' }} />
      <Tab.Screen name="ReceiptsTab" component={ReceiptsStack} options={{ title: 'Receipts' }} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}
