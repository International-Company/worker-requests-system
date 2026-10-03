import { ar } from './ar';

/** Active dictionary. Add `en` with the same shape and switch here when needed. */
export const t = ar;

/** Replaces `{name}` placeholders. */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
}
