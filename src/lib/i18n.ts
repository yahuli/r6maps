import type { TranslationEntry, UiMessages } from '../types'

export function createTranslator(messages: UiMessages, locale: string) {
  const selected = messages[locale] ?? messages.en ?? {}
  const fallback = messages.en ?? {}

  return (key: string) => selected[key] ?? fallback[key] ?? key
}

export function localizeEntity({
  entityType,
  entityId,
  field,
  fallback,
  locale,
  translations,
}: {
  entityType: TranslationEntry['entityType']
  entityId: string
  field: TranslationEntry['field']
  fallback: string
  locale: string
  translations: TranslationEntry[]
}) {
  if (locale === 'en') {
    return fallback
  }

  const match = translations.find(
    (translation) =>
      translation.entityType === entityType &&
      translation.entityId === entityId &&
      translation.field === field &&
      translation.locale === locale &&
      translation.status !== 'deprecated',
  )

  return match?.value || fallback
}
