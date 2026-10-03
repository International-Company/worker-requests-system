/**
 * Whitelisted, typed system settings. Only keys defined here can be stored,
 * which prevents the settings table from becoming an arbitrary key/value dump.
 */
interface NumberSetting {
  type: 'number';
  default: number;
  min: number;
  max: number;
  label: string;
  group: SettingGroup;
  unit?: string;
}
interface BooleanSetting {
  type: 'boolean';
  default: boolean;
  label: string;
  group: SettingGroup;
}
interface StringSetting {
  type: 'string';
  default: string;
  maxLength: number;
  label: string;
  group: SettingGroup;
}
export type SettingDefinition = NumberSetting | BooleanSetting | StringSetting;
export type SettingGroup = 'system' | 'notifications' | 'presence' | 'images';

export const SETTINGS = {
  'system.companyName': {
    type: 'string',
    default: 'الشركة',
    maxLength: 80,
    label: 'اسم الشركة',
    group: 'system',
  },
  'notifications.reminderIntervalSeconds': {
    type: 'number',
    default: 300,
    min: 60,
    max: 3600,
    label: 'إعادة التنبيه إذا لم يتم استلام الطلب بعد',
    unit: 'ثانية',
    group: 'notifications',
  },
  'notifications.maxReminders': {
    type: 'number',
    default: 3,
    min: 0,
    max: 20,
    label: 'الحد الأقصى لعدد مرات إعادة التنبيه',
    group: 'notifications',
  },
  'notifications.ttlSeconds': {
    type: 'number',
    default: 86400,
    min: 600,
    max: 2419200,
    label: 'مدة احتفاظ خدمة الإشعارات بالإشعار إذا كان الجهاز غير متصل',
    unit: 'ثانية',
    group: 'notifications',
  },
  'presence.heartbeatIntervalSeconds': {
    type: 'number',
    default: 60,
    min: 30,
    max: 600,
    label: 'الفاصل بين نبضات الاتصال من واجهة العامل',
    unit: 'ثانية',
    group: 'presence',
  },
  'presence.onlineThresholdSeconds': {
    type: 'number',
    default: 150,
    min: 30,
    max: 1800,
    label: 'اعتبار العامل غير متصل بعد انقطاع النبض لمدة',
    unit: 'ثانية',
    group: 'presence',
  },
  'images.maxDimension': {
    type: 'number',
    default: 1600,
    min: 640,
    max: 2560,
    label: 'أقصى أبعاد للصورة بعد الضغط',
    unit: 'بكسل',
    group: 'images',
  },
  'images.quality': {
    type: 'number',
    default: 80,
    min: 50,
    max: 95,
    label: 'جودة ضغط الصور',
    unit: '%',
    group: 'images',
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]['default'] extends number
  ? number
  : (typeof SETTINGS)[K]['default'] extends boolean
    ? boolean
    : string;

export function validateSettingValue(key: string, value: unknown): value is number | boolean | string {
  const def = (SETTINGS as Record<string, SettingDefinition>)[key];
  if (!def) return false;
  switch (def.type) {
    case 'number':
      return typeof value === 'number' && Number.isInteger(value) && value >= def.min && value <= def.max;
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string' && value.trim().length > 0 && value.length <= def.maxLength;
  }
}
