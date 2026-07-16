/**
 * SMS reading service for Android.
 *
 * IMPORTANT — REQUIRES NATIVE BUILD:
 * ───────────────────────────────────
 * Reading the device SMS inbox requires `react-native-get-sms-android`.
 * This package is included in package.json and will be automatically linked
 * when you run `npx expo prebuild` to generate the native Android project.
 *
 * Steps to enable SMS:
 *   1. Run: npx expo prebuild --platform android --clean
 *   2. Build and run: npx expo run:android
 *
 * The SMS module will be automatically linked via Expo autolinking.
 * SMS Import is Android-only (iOS does not allow SMS access).
 */

import { Platform, PermissionsAndroid, Alert } from 'react-native';
import SmsAndroid from 'react-native-get-sms-android';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeviceSMS {
  _id: string;
  thread_id: string;
  address: string; // sender phone number or short code
  date: string;    // milliseconds since epoch (as string)
  body: string;
}

export interface SMSConversation {
  address: string;
  threadId: string;
  displayName: string; // same as address unless contacts are resolved
  latestDate: number;
  messages: DeviceSMS[];
}

// ─── Module availability ──────────────────────────────────────────────────────

/**
 * SMS reading is available on Android after running `expo prebuild`.
 * The module is automatically linked via Expo autolinking.
 */
export const isSMSNativeAvailable: boolean = Platform.OS === 'android';

// ─── Permission ───────────────────────────────────────────────────────────────

export async function requestSMSPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    Alert.alert('Not supported', 'Reading SMS is only available on Android.');
    return false;
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    {
      title: 'Read SMS Permission',
      message:
        'SmartSpend needs access to your SMS inbox to find MoMo transaction messages. ' +
        'Your messages are never uploaded without your explicit confirmation.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function checkSMSPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
}

// ─── Reading SMS ──────────────────────────────────────────────────────────────

export interface ReadSMSFilter {
  /** Inclusive start date (ms since epoch). */
  minDate?: number;
  /** Inclusive end date (ms since epoch). */
  maxDate?: number;
  /** Filter by sender address (exact match). */
  address?: string;
  /** Maximum number of messages to return (default 500). */
  maxCount?: number;
}

/** Read SMS messages from the device inbox. Android only. */
export function readSMS(filter: ReadSMSFilter = {}): Promise<DeviceSMS[]> {
  if (Platform.OS !== 'android') {
    return Promise.reject(
      new Error('SMS reading is only available on Android.'),
    );
  }

  // Check if SmsAndroid module is available
  if (!SmsAndroid || typeof SmsAndroid.list !== 'function') {
    return Promise.reject(
      new Error(
        'SMS module not available. Make sure you have run "npx expo prebuild" ' +
        'and built the native Android app with "npx expo run:android".'
      ),
    );
  }

  const filterObj: Record<string, unknown> = {
    box: 'inbox',
    maxCount: filter.maxCount ?? 500,
  };
  if (filter.minDate !== undefined) filterObj.minDate = filter.minDate;
  if (filter.maxDate !== undefined) filterObj.maxDate = filter.maxDate;
  if (filter.address !== undefined) filterObj.address = filter.address;

  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify(filterObj),
      (fail: string) => reject(new Error(fail)),
      (_count: number, smsList: string) => {
        try {
          resolve(JSON.parse(smsList) as DeviceSMS[]);
        } catch {
          resolve([]);
        }
      },
    );
  });
}

// ─── Grouping helpers ─────────────────────────────────────────────────────────

/** Group a flat list of SMS messages into conversations keyed by sender address. */
export function groupByConversation(messages: DeviceSMS[]): SMSConversation[] {
  // Handle null, undefined, or empty arrays
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const map = new Map<string, SMSConversation>();

  for (const msg of messages) {
    const key = msg.address ?? 'Unknown';
    if (!map.has(key)) {
      map.set(key, {
        address: key,
        threadId: msg.thread_id,
        displayName: key,
        latestDate: 0,
        messages: [],
      });
    }
    const conv = map.get(key)!;
    conv.messages.push(msg);
    const d = parseInt(msg.date, 10);
    if (!isNaN(d) && d > conv.latestDate) conv.latestDate = d;
  }

  return Array.from(map.values()).sort((a, b) => b.latestDate - a.latestDate);
}

/** Format a Unix ms timestamp as a short relative label for display. */
export function formatSMSDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
