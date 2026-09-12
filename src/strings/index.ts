import { en } from "./en";

export type Strings = typeof en;

export interface PluralForms {
  one: string;
  other: string;
}

export const strings: Strings = en;

const numbers = new Intl.NumberFormat("en-US");

export const formatCount = (n: number): string => numbers.format(n);

export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

export function plural(forms: PluralForms, n: number): string {
  return fill(n === 1 ? forms.one : forms.other, { n: formatCount(n) });
}
