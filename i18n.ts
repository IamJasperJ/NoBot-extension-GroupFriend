import { en } from './en'
import { getLanguage } from './host'

export function t(zh: string, vars?: Record<string, string | number>): string {
  const template = getLanguage() === 'en' ? (en[zh] ?? zh) : zh
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(vars?.[key] ?? match))
}
