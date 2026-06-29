/**
 * SMS reading service for Android.
 *
 * IMPORTANT — REQUIRES A CUSTOM DEVELOPMENT BUILD:
 * ─────────────────────────────────────────────────
 * Reading the device SMS inbox requires `react-native-get-sms-android`, which:
 *   • Is NOT included in the standard package.json (it ships AGP 3.x which
 *     is incompatible with the project's AGP 8.x build).
 *   • Must be added manually when creating a custom SMS-enabled dev build.
 *
 * Steps to enable SMS in a custom build:
 *   1. npm install react-native-get-sms-android
 *   2. npx expo prebuild (regenerates android/ with the library linked)
 *   3. npx expo run:android  — OR —  eas build --profile development --platform android
 *   4. Remove the package again for the standard build: npm uninstall react-native-get-sms-android
 *
 * In standard Expo Go or a build without the package, `isSMSNativeAvailable`
 * will be false and the SMS Import screen shows a setup notice.
 *
 * We access the native module via NativeModules.SmsAndroid (registered at
 * runtime by the library when linked) rather than a direct import so that
 * Metro does not fail to resolve the module when the package is absent.
 */

import { NativeModules, Platform, PermissionsAndroid } from 'react-native';

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
 * The native module is registered as NativeModules.SmsAndroid by
 * react-native-get-sms-android when it is linked into the build.
 * This is null in Expo Go and in any build that does not include the library.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SmsAndroid: any =
  Platform.OS === 'android' ? (NativeModules.SmsAndroid ?? null) : null;

/** True only on Android with the native SMS module linked into this build. */
export const isSMSNativeAvailable: boolean = SmsAndroid !== null;

// ─── Permission ───────────────────────────────────────────────────────────────

export async function requestSMSPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
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

/** Read SMS messages from the device inbox. Throws if native module not linked. */
export function readSMS(filter: ReadSMSFilter = {}): Promise<DeviceSMS[]> {
  if (!isSMSNativeAvailable) {
    return Promise.reject(
      new Error(
        'SMS reading requires a custom development build with ' +
          'react-native-get-sms-android linked. ' +
          'See frontend/README.md for setup instructions.',
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
