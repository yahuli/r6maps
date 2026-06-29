export function buildDeleteMarkerPatch({ markerId, markers, translations }) {
  const marker = markers.find((candidate) => candidate.id === markerId);

  if (!marker) {
    throw new Error(`Cannot build delete patch for unknown marker: ${markerId}`);
  }

  const remainingTranslations = translations.filter(
    (translation) => !(translation.entityType === 'marker' && translation.entityId === markerId),
  );
  const files = [
    {
      path: `public/data/community/markers/${marker.mapId}.json`,
      action: 'replace',
      content: markers.filter((candidate) => candidate.mapId === marker.mapId && candidate.id !== markerId),
    },
  ];

  if (remainingTranslations.length !== translations.length) {
    files.push({
      path: 'public/data/community/translations.json',
      action: 'replace',
      content: remainingTranslations,
    });
  }

  return {
    branch: `community/delete-${markerId}`,
    title: `Delete marker ${markerId}`,
    files,
    checklist: [
      'Only community data changed',
      'Related marker translations were removed',
      'CI validates references after deletion',
      'Auto merge waits for qualified support and checks opposition',
    ],
  };
}

export function summarizePatchForPreview(patch) {
  return {
    branch: patch.branch,
    title: patch.title,
    files: patch.files.map((file) => {
      if (!Array.isArray(file.content)) {
        return file;
      }

      return {
        path: file.path,
        action: file.action,
        itemCount: file.content.length,
        sample: file.content.slice(-3),
      };
    }),
    checklist: patch.checklist,
  };
}
