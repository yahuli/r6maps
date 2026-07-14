import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSplitCommunityMarkerFiles } from './community-markers.mjs';

const VALID_MARKER_TYPES = new Set([
  'camera',
  'ceiling-hatch',
  'floor-hatch',
  'breakable-wall',
  'line-of-sight-wall',
  'line-of-sight-floor',
  'text-label',
  'spawn',
  'skylight',
  'drone-tunnel',
  'vertical-route',
  'ladder',
  'fire-extinguisher',
  'gas-pipe',
  'insertion-point',
  'compass',
  'wall',
  'door',
  'double-door',
  'window',
  'double-window',
  'bomb',
]);
const VALID_SITE_LETTERS = new Set(['A', 'B']);
const VALID_DIRECTIONS = new Set(['up', 'down']);
const VALID_MARKER_STATUSES = new Set(['published', 'proposed', 'deprecated']);
const VALID_MAP_STATUSES = new Set(['official', 'legacy']);
const VALID_SOURCES = new Set(['official', 'community']);
const VALID_LOCALES = new Set(['en', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR', 'it-IT', 'pl-PL']);
const VALID_TRANSLATION_ENTITIES = new Set(['map', 'marker', 'floor']);
const VALID_TRANSLATION_FIELDS = new Set(['name', 'label']);
const ROTATION_MARKER_TYPES = VALID_MARKER_TYPES;

export function validateRepositoryData(repositoryData) {
  const errors = [];
  const maps = Array.isArray(repositoryData.maps) ? repositoryData.maps : [];
  const markers = Array.isArray(repositoryData.markers) ? repositoryData.markers : [];
  const translations = Array.isArray(repositoryData.translations) ? repositoryData.translations : [];
  const mapIds = new Set();
  const markerIds = new Set();
  const floorIds = new Set();
  const floorIdsByMap = new Map();

  for (const map of maps) {
    requireString(errors, map.id, `map id`);
    requireString(errors, map.name, `map ${map.id} name`);

    if (!VALID_MAP_STATUSES.has(map.status)) {
      errors.push(`map ${map.id} has invalid status: ${map.status}`);
    }

    if (mapIds.has(map.id)) {
      errors.push(`duplicate map id: ${map.id}`);
    }
    mapIds.add(map.id);

    if (map.source?.provider === 'ubisoft') {
      if (!map.source?.url?.startsWith('https://www.ubisoft.com/')) {
        errors.push(`map ${map.id} source.url must point to Ubisoft`);
      }

      if (!isUbisoftBlueprintZip(map.source?.blueprintZip)) {
        errors.push(`map ${map.id} source.blueprintZip must point to a Ubisoft blueprint CDN`);
      }
    } else if (map.source?.provider === 'r6maps-legacy') {
      if (!map.source?.url?.startsWith('https://github.com/capajon/r6maps')) {
        errors.push(`map ${map.id} legacy source.url must point to capajon/r6maps`);
      }
      requireString(errors, map.source?.revision, `map ${map.id} legacy source revision`);
      requireString(errors, map.source?.importedAt, `map ${map.id} legacy source import date`);
    } else {
      errors.push(`map ${map.id} has invalid source provider: ${map.source?.provider}`);
    }

    const mapFloorIds = new Set();
    for (const floor of Array.isArray(map.floors) ? map.floors : []) {
      requireString(errors, floor.id, `map ${map.id} floor id`);
      if (floor.image != null && !String(floor.image).startsWith(`maps/official/${map.id}/`)) {
        errors.push(`map ${map.id} floor image must live under maps/official/${map.id}/`);
      }
      mapFloorIds.add(floor.id);
      floorIds.add(floor.id);
    }
    floorIdsByMap.set(map.id, mapFloorIds);
  }

  for (const marker of markers) {
    requireString(errors, marker.id, `marker id`);

    if (markerIds.has(marker.id)) {
      errors.push(`duplicate marker id: ${marker.id}`);
    }
    markerIds.add(marker.id);

    if (!mapIds.has(marker.mapId)) {
      errors.push(`marker ${marker.id} references unknown map: ${marker.mapId}`);
    }

    if (mapIds.has(marker.mapId) && !floorIdsByMap.get(marker.mapId)?.has(marker.floorId)) {
      errors.push(`marker ${marker.id} references unknown floor: ${marker.floorId}`);
    }

    if (!VALID_MARKER_TYPES.has(marker.type)) {
      errors.push(`marker ${marker.id} has invalid type: ${marker.type}`);
    }

    validateMarkerMetadata(errors, marker);

    if (!VALID_MARKER_STATUSES.has(marker.status)) {
      errors.push(`marker ${marker.id} has invalid status: ${marker.status}`);
    }

    if (!VALID_SOURCES.has(marker.source)) {
      errors.push(`marker ${marker.id} has invalid source: ${marker.source}`);
    }

    if (typeof marker.x !== 'number' || marker.x < 0 || marker.x > 1) {
      errors.push(`marker ${marker.id} x must be between 0 and 1`);
    }

    if (typeof marker.y !== 'number' || marker.y < 0 || marker.y > 1) {
      errors.push(`marker ${marker.id} y must be between 0 and 1`);
    }
  }

  const translationKeys = new Set();
  const floorTranslationLocales = new Map();

  for (const translation of translations) {
    if (!VALID_TRANSLATION_ENTITIES.has(translation.entityType)) {
      errors.push(`translation has invalid entity type: ${translation.entityType}`);
    }

    if (!VALID_TRANSLATION_FIELDS.has(translation.field)) {
      errors.push(`translation ${translation.entityId} has invalid field: ${translation.field}`);
    }

    if (translation.entityType === 'floor' && translation.field !== 'name') {
      errors.push(`floor translation ${translation.entityId} has invalid field: ${translation.field}`);
    }

    if (!VALID_LOCALES.has(translation.locale)) {
      errors.push(`translation ${translation.entityId} has invalid locale: ${translation.locale}`);
    }

    if (typeof translation.value !== 'string' || translation.value.trim() === '') {
      errors.push(`translation value is required: ${translation.entityId}`);
    }

    if (!VALID_MARKER_STATUSES.has(translation.status)) {
      errors.push(`translation ${translation.entityId} has invalid status: ${translation.status}`);
    }

    if (translation.entityType === 'map' && !mapIds.has(translation.entityId)) {
      errors.push(`translation references unknown map: ${translation.entityId}`);
    }

    if (translation.entityType === 'marker' && !markerIds.has(translation.entityId)) {
      errors.push(`translation references unknown marker: ${translation.entityId}`);
    }

    if (translation.entityType === 'floor') {
      if (!floorIds.has(translation.entityId)) {
        errors.push(`translation references unknown floor: ${translation.entityId}`);
      }
      if (translation.status !== 'published') {
        errors.push(`floor translation ${translation.entityId} must be published`);
      }
    }

    const translationKey = `${translation.entityType}:${translation.entityId}:${translation.field}:${translation.locale}`;
    if (translationKeys.has(translationKey)) {
      errors.push(`duplicate translation: ${translationKey}`);
    }
    translationKeys.add(translationKey);

    if (translation.entityType === 'floor' && translation.field === 'name' && translation.status === 'published') {
      if (!floorTranslationLocales.has(translation.entityId)) {
        floorTranslationLocales.set(translation.entityId, new Set());
      }
      floorTranslationLocales.get(translation.entityId).add(translation.locale);
    }
  }

  for (const floorId of floorIds) {
    const translatedLocales = floorTranslationLocales.get(floorId) ?? new Set();
    for (const locale of VALID_LOCALES) {
      if (!translatedLocales.has(locale)) {
        errors.push(`missing floor translation for ${floorId} locale ${locale}`);
      }
    }
  }

  return { errors };
}

export async function validateRepositoryFiles(rootDir) {
  const mapsFile = await readJsonSafe(path.join(rootDir, 'public/data/official/maps.json'), 'public/data/official/maps.json');
  const maps = mapsFile.value ?? [];
  const staticProposalError = await staticProposalDirectoryError(rootDir);
  const markerFiles = await readSplitCommunityMarkerFiles(path.join(rootDir, 'public/data/community'));
  const markers = markerFiles.markers;
  const markerIndexCoverageErrors = validateMarkerIndexCoverage(maps, markerFiles.mapIds);
  const translationsFile = await readJsonSafe(
    path.join(rootDir, 'public/data/community/translations.json'),
    'public/data/community/translations.json',
  );
  const translations = translationsFile.value ?? [];
  const result = validateRepositoryData({ maps, markers, translations });

  return {
    errors: [
      ...[mapsFile.error, staticProposalError, translationsFile.error].filter(Boolean),
      ...markerFiles.errors,
      ...markerIndexCoverageErrors,
      ...result.errors,
    ],
    maps,
    markers,
    translations,
  };
}

function validateMarkerIndexCoverage(maps, markerIndexMapIds) {
  const errors = [];
  const indexedMapIds = new Set(markerIndexMapIds);

  for (const map of maps) {
    if (typeof map?.id === 'string' && map.id.trim() !== '' && !indexedMapIds.has(map.id)) {
      errors.push(`public/data/community/markers/index.json must list map id: ${map.id}`);
    }
  }

  return errors;
}

async function staticProposalDirectoryError(rootDir) {
  try {
    await stat(path.join(rootDir, 'public/data/community/proposals'));
    return 'public/data/community/proposals must not contain static demo proposal data';
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return undefined;
    }

    const message = error instanceof Error ? error.message : String(error);
    return `public/data/community/proposals could not be checked: ${message}`;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonSafe(filePath, publicPath) {
  try {
    return { value: await readJson(filePath), error: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { value: undefined, error: `${publicPath} could not be read: ${message}` };
  }
}

function requireString(errors, value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${fieldName} is required`);
  }
}

function validateMarkerMetadata(errors, marker) {
  if (Object.hasOwn(marker, 'size')) {
    if (typeof marker.size !== 'number' || !Number.isFinite(marker.size) || marker.size < 0.5 || marker.size > 2.5) {
      errors.push(`marker ${marker.id} size must be between 0.5 and 2.5`);
    }
  }

  if (Object.hasOwn(marker, 'rotation')) {
    if (!ROTATION_MARKER_TYPES.has(marker.type)) {
      errors.push(`marker ${marker.id} rotation is not supported for marker type ${marker.type}`);
    } else if (typeof marker.rotation !== 'number' || !Number.isFinite(marker.rotation) || marker.rotation < -180 || marker.rotation > 180) {
      errors.push(`marker ${marker.id} rotation must be between -180 and 180`);
    }
  }

  if (marker.type === 'bomb') {
    if (!isPositiveInteger(marker.siteNumber)) {
      errors.push(`bomb marker ${marker.id} siteNumber must be a positive integer`);
    }
    if (!VALID_SITE_LETTERS.has(marker.siteLetter)) {
      errors.push(`bomb marker ${marker.id} siteLetter must be A or B`);
    }
    return;
  }

  if (marker.type === 'spawn') {
    if (!isPositiveInteger(marker.spawnNumber)) {
      errors.push(`spawn marker ${marker.id} spawnNumber must be a positive integer`);
    }
    requireString(errors, marker.spawnName, `spawn marker ${marker.id} spawnName`);
    return;
  }

  if (marker.type === 'vertical-route') {
    if (!VALID_DIRECTIONS.has(marker.direction)) {
      errors.push(`${marker.type} marker ${marker.id} direction must be up or down`);
    }
  }

  if (marker.type === 'text-label') {
    requireString(errors, marker.label, `text-label marker ${marker.id} label`);
  }
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isUbisoftBlueprintZip(value) {
  return (
    typeof value === 'string' &&
    (value.startsWith('https://ubistatic-a.ubisoft.com/0106/gamesites/rainbow6/blueprints/') ||
      value.startsWith('https://static2.cdn.ubi.com/gamesites/rainbow6/blueprints/')) &&
    value.endsWith('.zip')
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await validateRepositoryFiles(rootDir);

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(`data validation: ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`data validation: ${result.maps.length} maps and ${result.markers.length} markers passed`);
  }
}
