import { SETTINGS, validateSettingValue } from './settings.definitions';

describe('settings whitelist', () => {
  it('accepts valid values within bounds', () => {
    expect(validateSettingValue('notifications.reminderIntervalSeconds', 300)).toBe(true);
    expect(validateSettingValue('notifications.maxReminders', 0)).toBe(true);
    expect(validateSettingValue('system.companyName', 'شركة الاختبار')).toBe(true);
  });

  it('rejects out-of-range, wrong types, blanks and unknown keys', () => {
    expect(validateSettingValue('notifications.reminderIntervalSeconds', 10)).toBe(false);
    expect(validateSettingValue('notifications.reminderIntervalSeconds', 300.5)).toBe(false);
    expect(validateSettingValue('notifications.maxReminders', '3')).toBe(false);
    expect(validateSettingValue('system.companyName', '   ')).toBe(false);
    expect(validateSettingValue('anything.else', 1)).toBe(false);
  });

  it('every default satisfies its own rule', () => {
    for (const [key, def] of Object.entries(SETTINGS)) expect(validateSettingValue(key, def.default)).toBe(true);
  });

  it('default reminder policy is 5 minutes, max 3 reminders', () => {
    expect(SETTINGS['notifications.reminderIntervalSeconds'].default).toBe(300);
    expect(SETTINGS['notifications.maxReminders'].default).toBe(3);
  });
});
