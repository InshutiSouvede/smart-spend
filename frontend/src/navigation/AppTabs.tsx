import React from 'react';
import { TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { NavigatorScreenParams } from '@react-navigation/native';

import { HomeScreen } from '../screens/HomeScreen';
import { TransactionsScreen } from '../screens/TransactionsScreen';
import { SMSImportScreen } from '../screens/SMSImportScreen';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import { UnmatchedExpensesScreen } from '../screens/UnmatchedExpensesScreen';
import { ReceiptsScreen } from '../screens/ReceiptsScreen';
import { ReceiptUploadScreen } from '../screens/ReceiptUploadScreen';
import { ReceiptDetailScreen } from '../screens/ReceiptDetailScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { ExportScreen } from '../screens/ExportScreen';
import { colors } from '../theme';

// ─── Param lists ─────────────────────────────────────────────────────────────

export type AppTabParamList = {
  HomeTab: undefined;
  AnalyticsTab: undefined;
  TransactionsTab: NavigatorScreenParams<TransactionsStackParamList>;
  ReceiptsTab: NavigatorScreenParams<ReceiptsStackParamList>;
  ExportTab: undefined;
  ProfileTab: undefined;
};

export type TransactionsStackParamList = {
  TransactionsList: undefined;
  SMSImport: undefined;
  ItemDetails: { smsTransactionId: number; amount: number; merchant?: string };
  UnmatchedExpenses: undefined;
};

export type ReceiptsStackParamList = {
  ReceiptsList: undefined;
  ReceiptUpload: undefined;
  ReceiptDetail: { receiptId: number };
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
      <TxStack.Screen
        name="ItemDetails"
        component={ItemDetailsScreen}
        options={({ navigation }) => ({
          title: 'Purchase Details',
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => navigation.popToTop()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginRight: 8 }}
            >
              <Ionicons name="arrow-back" size={24} color={colors.primary} />
            </TouchableOpacity>
          ),
        })}
      />
      <TxStack.Screen
        name="UnmatchedExpenses"
        component={UnmatchedExpensesScreen}
        options={({ navigation }) => ({
          title: 'Unmatched Expenses',
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => navigation.popToTop()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginRight: 8 }}
            >
              <Ionicons name="arrow-back" size={24} color={colors.primary} />
            </TouchableOpacity>
          ),
        })}
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
      <RxStack.Screen
        name="ReceiptDetail"
        component={ReceiptDetailScreen}
        options={{ title: 'Receipt Details' }}
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
            HomeTab:         'home-outline',
            AnalyticsTab:    'bar-chart-outline',
            TransactionsTab: 'list-outline',
            ReceiptsTab:     'receipt-outline',
            ExportTab:       'download-outline',
            ProfileTab:      'person-outline',
          };
          return <Ionicons name={icons[route.name] ?? 'ellipse-outline'} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab"         component={HomeScreen}        options={{ title: 'Dashboard' }} />
      <Tab.Screen name="AnalyticsTab"    component={AnalyticsScreen}   options={{ title: 'Analytics' }} />
      <Tab.Screen
        name="TransactionsTab"
        component={TransactionsStack}
        options={{ title: 'Transactions', headerShown: false }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('TransactionsTab', { screen: 'TransactionsList' });
          },
        })}
      />
      <Tab.Screen name="ReceiptsTab"     component={ReceiptsStack}     options={{ title: 'Receipts', headerShown: false }} />
      <Tab.Screen name="ExportTab"       component={ExportScreen}      options={{ title: 'Export' }} />
      <Tab.Screen name="ProfileTab"      component={ProfileScreen}     options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

