export function localizeEntity({ entityType, entityId, field, fallback, locale, translations }) {
  if (!locale || locale === 'en') {
    return fallback;
  }

  const match = translations.find((translation) =>
    translation.entityType === entityType &&
    translation.entityId === entityId &&
    translation.field === field &&
    translation.locale === locale &&
    translation.status !== 'deprecated'
  );

  return match?.value || fallback;
}
