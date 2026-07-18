/**
 * SMS reading service for Android.
 *
 * Reading the device SMS inbox requires the native
 * `react-native-get-sms-android` package.
 *
 * The package exposes its Android bridge as:
 *
 *   NativeModules.Sms
 *
 * This service accesses that native module directly so that module
 * availability can be checked reliably in both development and release APKs.
 *
 * SMS reading is Android-only. iOS does not allow applications to read the
 * device SMS inbox.
 */

import {
  Alert,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

// ─── Native module types ──────────────────────────────────────────────────────

interface NativeSmsModule {
  list(
    filter: string,
    failureCallback: (error: string) => void,
    successCallback: (count: number, smsList: string) => void,
  ): void;
}

/**
 * `react-native-get-sms-android` exports `NativeModules.Sms`.
 *
 * Accessing it directly avoids confusion between:
 * - the npm package name;
 * - the local import variable name;
 * - the actual Android native-module name.
 */
const SmsNativeModule: NativeSmsModule | null =
  Platform.OS === 'android'
    ? (NativeModules.Sms as NativeSmsModule | null) ?? null
    : null;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeviceSMS {
  _id: string;
  thread_id: string;
  address: string;
  date: string;
  body: string;
}

export interface SMSConversation {
  address: string;
  threadId: string;
  displayName: string;
  latestDate: number;
  messages: DeviceSMS[];
}

export interface ReadSMSFilter {
  /** Inclusive start date in milliseconds since Unix epoch. */
  minDate?: number;

  /** Inclusive end date in milliseconds since Unix epoch. */
  maxDate?: number;

  /** Exact sender address or short code. */
  address?: string;

  /** Maximum number of messages to return. Defaults to 500. */
  maxCount?: number;
}

// ─── Module availability ──────────────────────────────────────────────────────

/**
 * True only when:
 * - the app is running on Android;
 * - NativeModules.Sms exists;
 * - the native `list` method is available.
 */
export const isSMSNativeAvailable: boolean =
  Platform.OS === 'android' &&
  SmsNativeModule != null &&
  typeof SmsNativeModule.list === 'function';

/**
 * Returns useful information about the native SMS module.
 *
 * This is intended for temporary debugging when testing a release APK.
 */
export function getSMSDiagnostics(): {
  platform: string;
  moduleExists: boolean;
  listMethodExists: boolean;
  smsRelatedModules: string[];
} {
  const smsRelatedModules = Object.keys(NativeModules).filter(name =>
    name.toLowerCase().includes('sms'),
  );

  return {
    platform: Platform.OS,
    moduleExists: Boolean(NativeModules.Sms),
    listMethodExists: typeof NativeModules.Sms?.list === 'function',
    smsRelatedModules,
  };
}

/**
 * Shows native-module diagnostics in an alert.
 *
 * You can temporarily call this from the SMS screen before reading messages.
 */
export function showSMSDiagnostics(): void {
  const diagnostics = getSMSDiagnostics();

  Alert.alert(
    'SMS diagnostics',
    [
      `Platform: ${diagnostics.platform}`,
      `NativeModules.Sms exists: ${diagnostics.moduleExists}`,
      `Sms.list exists: ${diagnostics.listMethodExists}`,
      `SMS-related modules: ${
        diagnostics.smsRelatedModules.length > 0
          ? diagnostics.smsRelatedModules.join(', ')
          : 'none'
      }`,
    ].join('\n'),
  );
}

// ─── Permissions ──────────────────────────────────────────────────────────────

export async function requestSMSPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    Alert.alert(
      'Not supported',
      'Reading SMS is only available on Android.',
    );

    return false;
  }

  try {
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
  } catch (error) {
    console.error('Failed to request READ_SMS permission:', error);
    return false;
  }
}

export async function checkSMSPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  try {
    return await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.READ_SMS,
    );
  } catch (error) {
    console.error('Failed to check READ_SMS permission:', error);
    return false;
  }
}

// ─── Reading SMS ──────────────────────────────────────────────────────────────

/**
 * Reads SMS messages from the Android inbox.
 */
export function readSMS(
  filter: ReadSMSFilter = {},
): Promise<DeviceSMS[]> {
  if (Platform.OS !== 'android') {
    return Promise.reject(
      new Error('SMS reading is only available on Android.'),
    );
  }

  if (!SmsNativeModule || typeof SmsNativeModule.list !== 'function') {
    const diagnostics = getSMSDiagnostics();

    console.error('Native SMS module diagnostics:', diagnostics);

    return Promise.reject(
      new Error(
        'The native SMS module is missing from this APK. ' +
          `NativeModules.Sms exists: ${diagnostics.moduleExists}. ` +
          `Sms.list exists: ${diagnostics.listMethodExists}. ` +
          `Detected SMS-related modules: ${
            diagnostics.smsRelatedModules.length > 0
              ? diagnostics.smsRelatedModules.join(', ')
              : 'none'
          }.`,
      ),
    );
  }

  const filterObject: Record<string, unknown> = {
    box: 'inbox',
    maxCount: filter.maxCount ?? 500,
  };

  if (filter.minDate !== undefined) {
    filterObject.minDate = filter.minDate;
  }

  if (filter.maxDate !== undefined) {
    filterObject.maxDate = filter.maxDate;
  }

  if (filter.address !== undefined) {
    filterObject.address = filter.address;
  }

  return new Promise<DeviceSMS[]>((resolve, reject) => {
    try {
      SmsNativeModule.list(
        JSON.stringify(filterObject),

        (failure: string) => {
          console.error('NativeModules.Sms.list failed:', failure);

          reject(
            new Error(
              failure?.trim() || 'Failed to read SMS messages.',
            ),
          );
        },

        (_count: number, smsList: string) => {
          if (
            !smsList ||
            smsList.trim() === '' ||
            smsList === 'null'
          ) {
            resolve([]);
            return;
          }

          try {
            const parsed: unknown = JSON.parse(smsList);

            if (!Array.isArray(parsed)) {
              console.error(
                'Unexpected SMS response. Expected an array:',
                parsed,
              );

              reject(
                new Error(
                  'The SMS module returned an unexpected response.',
                ),
              );

              return;
            }

            const messages = parsed.filter(
              (item): item is DeviceSMS =>
                item !== null &&
                typeof item === 'object' &&
                typeof (item as DeviceSMS).address === 'string' &&
                typeof (item as DeviceSMS).body === 'string',
            );

            resolve(messages);
          } catch (error) {
            console.error('Failed to parse SMS response:', error);

            reject(
              new Error(
                `Failed to parse SMS response: ${
                  error instanceof Error
                    ? error.message
                    : String(error)
                }`,
              ),
            );
          }
        },
      );
    } catch (error) {
      console.error('Error calling NativeModules.Sms.list:', error);

      reject(
        new Error(
          `Failed to read SMS: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        ),
      );
    }
  });
}

// ─── Grouping helpers ─────────────────────────────────────────────────────────

/**
 * Groups a flat list of SMS messages by sender address.
 */
export function groupByConversation(
  messages: DeviceSMS[],
): SMSConversation[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const conversationMap = new Map<string, SMSConversation>();

  for (const message of messages) {
    const address = message.address?.trim() || 'Unknown';

    if (!conversationMap.has(address)) {
      conversationMap.set(address, {
        address,
        threadId: message.thread_id,
        displayName: address,
        latestDate: 0,
        messages: [],
      });
    }

    const conversation = conversationMap.get(address);

    if (!conversation) {
      continue;
    }

    conversation.messages.push(message);

    const timestamp = Number.parseInt(message.date, 10);

    if (
      Number.isFinite(timestamp) &&
      timestamp > conversation.latestDate
    ) {
      conversation.latestDate = timestamp;
    }
  }

  for (const conversation of conversationMap.values()) {
    conversation.messages.sort((first, second) => {
      const firstDate = Number.parseInt(first.date, 10) || 0;
      const secondDate = Number.parseInt(second.date, 10) || 0;

      return secondDate - firstDate;
    });
  }

  return Array.from(conversationMap.values()).sort(
    (first, second) => second.latestDate - first.latestDate,
  );
}

/**
 * Formats a Unix timestamp in milliseconds as a short date label.
 */
export function formatSMSDate(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) {
    return 'Unknown date';
  }

  const date = new Date(milliseconds);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  const startOfMessageDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );

  const differenceInDays = Math.floor(
    (startOfToday.getTime() - startOfMessageDay.getTime()) /
      86_400_000,
  );

  if (differenceInDays === 0) {
    return 'Today';
  }

  if (differenceInDays === 1) {
    return 'Yesterday';
  }

  if (differenceInDays > 1 && differenceInDays < 7) {
    return `${differenceInDays}d ago`;
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}