import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { readSplitCommunityMarkers, writeSplitCommunityMarkers } from './community-markers.mjs';

const execFileAsync = promisify(execFile);

const SVG_WIDTH = 2560;
const SVG_HEIGHT = 1474;
const LEFT_OFFSET = 1275;
const TOP_OFFSET = 749;
const LEGACY_REPO_URL = 'https://github.com/capajon/r6maps';

const LEGACY_MAP_IDS = new Map([
  ['club', 'clubhouse'],
  ['hereford', 'hereford-base'],
  ['kafe', 'kafe-dostoyevsky'],
  ['plane', 'presidential-plane'],
  ['themepark', 'theme-park'],
]);

export function normalizeLegacyPoint({ left, top }) {
  return {
    x: roundNormalized((left + LEFT_OFFSET) / SVG_WIDTH),
    y: roundNormalized((top + TOP_OFFSET) / SVG_HEIGHT),
  };
}

export function legacyMapIdToCurrentId(legacyMapId) {
  return LEGACY_MAP_IDS.get(legacyMapId) ?? legacyMapId;
}

export function floorIdFromLegacyIndex(index) {
  if (index === 0) {
    return 'b1';
  }

  if (index >= 5) {
    return 'roof';
  }

  return `${index}f`;
}

export function convertLegacyMapData(legacyMaps, options = {}) {
  const {
    existingMaps = [],
    existingMarkers = [],
    existingTranslations = [],
    importedAt = new Date().toISOString().slice(0, 10),
    revision = 'legacy-r6maps',
  } = options;
  const mapsById = new Map(existingMaps.map((map) => [map.id, structuredClone(map)]));
  const importedMarkers = [];

  for (const [legacyMapId, legacyMap] of Object.entries(legacyMaps)) {
    const mapId = legacyMapIdToCurrentId(legacyMapId);
    const floorContext = createFloorContext(legacyMap.floors ?? []);
    const importedMap = createLegacyMapRecord({
      existingMap: mapsById.get(mapId),
      floorContext,
      importedAt,
      legacyMap,
      legacyMapId,
      mapId,
      revision,
    });

    mapsById.set(mapId, importedMap);
    importedMarkers.push(...convertLegacyMarkers({ floorContext, legacyMap, mapId }));
  }

  const retained = migrateRetainedCommunityMarkers(existingMarkers.filter((marker) => !marker.id.startsWith('legacy-')));
  const markers = [...retained.markers, ...importedMarkers];

  return {
    maps: Array.from(mapsById.values()),
    markers,
    translations: migrateRetainedTranslations(existingTranslations, retained.idMap, new Set(markers.map((marker) => marker.id))),
  };
}

export async function importLegacyRepository({ dataDir, legacyRepoDir }) {
  const [existingMaps, existingMarkers, existingTranslations, legacyMaps, revision] = await Promise.all([
    readJson(path.join(dataDir, 'official/maps.json')),
    readExistingCommunityMarkers(path.join(dataDir, 'community')),
    readJson(path.join(dataDir, 'community/translations.json')),
    loadLegacyMapData(legacyRepoDir),
    getGitRevision(legacyRepoDir),
  ]);

  const converted = convertLegacyMapData(legacyMaps, {
    existingMaps,
    existingMarkers,
    existingTranslations,
    importedAt: new Date().toISOString().slice(0, 10),
    revision,
  });

  await writeJson(path.join(dataDir, 'official/maps.json'), converted.maps);
  await writeSplitCommunityMarkers(path.join(dataDir, 'community'), converted.markers);
  await writeJson(path.join(dataDir, 'community/translations.json'), converted.translations);

  return {
    maps: converted.maps.length,
    markers: converted.markers.length,
    translations: converted.translations.length,
    importedMarkers: converted.markers.filter((marker) => marker.id.startsWith('legacy-')).length,
    revision,
  };
}

async function loadLegacyMapData(legacyRepoDir) {
  const [commonJs, langTermsJs, mapDataJs] = await Promise.all([
    readFile(path.join(legacyRepoDir, 'dev/js/common/common.global.js'), 'utf8'),
    readFile(path.join(legacyRepoDir, 'dev/js/lang-terms/lang-terms.js'), 'utf8'),
    readFile(path.join(legacyRepoDir, 'dev/js/main/main.map-data.js'), 'utf8'),
  ]);
  const context = {
    console,
    $: {
      extend,
    },
  };

  vm.createContext(context);
  vm.runInContext(commonJs, context);
  vm.runInContext(langTermsJs, context);
  vm.runInContext(mapDataJs, context);

  return context.R6MMainData.getMapData();
}

function convertLegacyMarkers({ floorContext, legacyMap, mapId }) {
  const markers = [];
  const serialByKey = new Map();

  appendMarkerGroup(markers, serialByKey, {
    floorContext,
    items: legacyMap.cameras,
    label: (item) => cleanLabel(item.location) || 'Security camera',
    mapId,
    type: 'camera',
  });
  appendMarkerGroup(markers, serialByKey, {
    floorContext,
    items: legacyMap.ceilingHatches,
    label: () => 'Ceiling hatch',
    mapId,
    type: 'ceiling-hatch',
  });
  appendMarkerGroup(markers, serialByKey, {
    floorContext,
    items: legacyMap.skylights,
    label: () => 'Skylight',
    mapId,
    type: 'skylight',
  });
  appendMarkerGroup(markers, serialByKey, {
    floorContext,
    items: legacyMap.spawnPoints,
    label: (item, serial) => formatSpawnLabel(serial, spawnNameFromLegacyItem(item, serial)),
    mapId,
    metadata: (item, serial) => ({
      spawnNumber: serial,
      spawnName: spawnNameFromLegacyItem(item, serial),
    }),
    type: 'spawn',
  });
  appendMarkerGroup(markers, serialByKey, {
    floorContext,
    items: legacyMap.bombObjectives,
    label: (item, serial) => {
      const site = bombSiteFromLegacyItem(item, serial);

      return `Bomb ${site.siteNumber}${site.siteLetter}`;
    },
    mapId,
    metadata: (item, serial) => bombSiteFromLegacyItem(item, serial),
    type: 'bomb',
  });
  appendMarkerGroup(markers, serialByKey, {
    floorContext,
    items: legacyMap.ladders,
    label: (item) => `Ladder ${directionFromLegacyItem(item)}`,
    mapId,
    metadata: (item) => ({ direction: directionFromLegacyItem(item) }),
    type: 'ladder',
  });

  return markers;
}

function appendMarkerGroup(markers, serialByKey, { floorContext, items = [], label, mapId, metadata, type }) {
  for (const item of Array.isArray(items) ? items : []) {
    const floorId = floorIdForLegacyItem(item, floorContext);
    const serialKey = `${mapId}-${type}-${floorId}`;
    const serial = (serialByKey.get(serialKey) ?? 0) + 1;
    const { x, y } = normalizeLegacyPoint(item);

    serialByKey.set(serialKey, serial);
    markers.push({
      id: `legacy-${mapId}-${type}-${floorId}-${String(serial).padStart(3, '0')}`,
      mapId,
      floorId,
      type,
      label: label(item, serial),
      x,
      y,
      ...(metadata?.(item, serial) ?? {}),
      source: 'community',
      status: 'published',
    });
  }
}

function formatSpawnLabel(spawnNumber, spawnName) {
  return `${spawnNumber} - ${spawnName}`;
}

function spawnNameFromLegacyItem(item, serial) {
  return cleanSpawnName(item.description) || cleanSpawnName(item.name) || `Spawn ${serial}`;
}

function cleanSpawnName(value) {
  return cleanLabel(value).replace(/\s*spawn(?: point)?\s*$/i, '').trim();
}

function bombSiteFromLegacyItem(item, serial) {
  const labelMatch = cleanLabel(item.label ?? item.description).match(/(\d+)\s*([AB])/i);
  const siteNumber = positiveIntegerOrDefault(item.siteNumber ?? item.set ?? labelMatch?.[1], Math.ceil(serial / 2));
  const siteLetter = siteLetterOrDefault(item.siteLetter ?? item.letter ?? labelMatch?.[2], serial % 2 === 0 ? 'B' : 'A');

  return { siteNumber, siteLetter };
}

function directionFromLegacyItem(item) {
  const directionValue = String(item.direction ?? item.dir ?? item.orientation ?? '').toLowerCase();

  if (directionValue.includes('down')) {
    return 'down';
  }

  if (directionValue.includes('up')) {
    return 'up';
  }

  if (item.down === true || item.isDown === true) {
    return 'down';
  }

  if (item.up === true || item.isUp === true) {
    return 'up';
  }

  return 'up';
}

function positiveIntegerOrDefault(value, fallback) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function siteLetterOrDefault(value, fallback) {
  const letter = String(value ?? '').toUpperCase();

  return letter === 'A' || letter === 'B' ? letter : fallback;
}

function migrateRetainedCommunityMarkers(markers) {
  const serialByType = new Map();
  const usedIds = new Set(markers.map((marker) => marker.id));
  const idMap = new Map();

  const migratedMarkers = markers.flatMap((marker) => {
    const type = marker.type === 'hatch' ? 'ceiling-hatch' : marker.type;

    if (!['camera', 'ceiling-hatch', 'spawn', 'skylight', 'vertical-route', 'ladder', 'bomb'].includes(type)) {
      return [];
    }

    usedIds.delete(marker.id);
    const migratedId = uniqueRetainedMarkerId(markerIdForType(marker, type), usedIds);
    usedIds.add(migratedId);
    idMap.set(marker.id, migratedId);

    const migrated = {
      ...marker,
      id: migratedId,
      type,
    };
    const serialKey = `${migrated.mapId}-${migrated.floorId}-${type}`;
    const serial = (serialByType.get(serialKey) ?? 0) + 1;

    serialByType.set(serialKey, serial);

    if (type === 'spawn') {
      const spawnNumber = positiveIntegerOrDefault(migrated.spawnNumber, serial);
      const spawnName = cleanSpawnName(migrated.spawnName || migrated.label) || `Spawn ${spawnNumber}`;

      return [{ ...migrated, label: formatSpawnLabel(spawnNumber, spawnName), spawnNumber, spawnName }];
    }

    if (type === 'bomb') {
      const site = bombSiteFromLegacyItem(migrated, serial);

      return [{ ...migrated, label: `Bomb ${site.siteNumber}${site.siteLetter}`, ...site }];
    }

    if (type === 'ladder' || type === 'vertical-route') {
      const direction = directionFromLegacyItem(migrated);
      const labelPrefix = type === 'ladder' ? 'Ladder' : 'Vertical route';

      return [{ ...migrated, label: `${labelPrefix} ${direction}`, direction }];
    }

    return [migrated];
  });

  return { idMap, markers: migratedMarkers };
}

function markerIdForType(marker, type) {
  if (marker.type === 'hatch' && type === 'ceiling-hatch') {
    return marker.id.replace(/(^|-)hatch($|-)/, '$1ceiling-hatch$2');
  }

  return marker.id;
}

function uniqueRetainedMarkerId(baseId, usedIds) {
  if (!usedIds.has(baseId)) {
    return baseId;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${baseId}-${suffix}`;

    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }
}

function migrateRetainedTranslations(translations, idMap, markerIds) {
  return translations.flatMap((translation) => {
    if (translation.entityType !== 'marker') {
      return [translation];
    }

    const entityId = idMap.get(translation.entityId);

    if (!entityId || !markerIds.has(entityId)) {
      return [];
    }

    return [{ ...translation, entityId }];
  });
}

function createFloorContext(floors) {
  const floorRecords = floors.map((floor) => ({
    id: floorIdFromLegacyFloor(floor),
    name: floorNameFromLegacyFloor(floor),
    sort: floorSortFromLegacyFloor(floor),
    legacyIndex: floor.index,
    default: Boolean(floor.default),
  }));
  const floorIdByIndex = new Map(floorRecords.map((floor) => [floor.legacyIndex, floor.id]));
  const defaultFloorId =
    floorRecords.find((floor) => floor.default)?.id ??
    floorRecords.find((floor) => floor.id !== 'roof')?.id ??
    floorRecords[0]?.id ??
    '1f';

  return {
    defaultFloorId,
    floorIdByIndex,
    floors: floorRecords.map(({ id, name, sort }) => ({ id, name, sort })),
  };
}

function createLegacyMapRecord({ existingMap, floorContext, importedAt, legacyMap, legacyMapId, mapId, revision }) {
  if (existingMap) {
    return {
      ...existingMap,
      floors: mergeFloors(existingMap.floors, floorContext.floors),
    };
  }

  return {
    id: mapId,
    name: cleanLabel(legacyMap.name) || titleize(legacyMapId),
    status: 'legacy',
    season: 'Legacy import',
    source: {
      provider: 'r6maps-legacy',
      url: LEGACY_REPO_URL,
      revision,
      importedAt,
    },
    floors: floorContext.floors,
  };
}

function floorIdForLegacyItem(item, floorContext) {
  if (item.floor != null && floorContext.floorIdByIndex.has(item.floor)) {
    return floorContext.floorIdByIndex.get(item.floor);
  }

  return floorContext.defaultFloorId;
}

function floorIdFromLegacyFloor(floor) {
  const name = String(floor.name?.full ?? floor.name?.short ?? '').toLowerCase();

  if (name.includes('roof') || name === 'r') {
    return 'roof';
  }

  if (name.includes('basement') || name === 'b') {
    return 'b1';
  }

  return floorIdFromLegacyIndex(floor.index);
}

function floorNameFromLegacyFloor(floor) {
  const id = floorIdFromLegacyFloor(floor);

  if (id === 'b1') {
    return 'B1';
  }

  if (id === 'roof') {
    return 'Roof';
  }

  return id.toUpperCase();
}

function floorSortFromLegacyFloor(floor) {
  const id = floorIdFromLegacyFloor(floor);

  if (id === 'b1') {
    return 0;
  }

  if (id === 'roof') {
    return 99;
  }

  return Number(id.replace('f', ''));
}

function mergeFloors(existingFloors = [], importedFloors = []) {
  const floorsById = new Map();

  for (const floor of [...existingFloors, ...importedFloors]) {
    floorsById.set(floor.id, floor);
  }

  return Array.from(floorsById.values()).sort((a, b) => a.sort - b.sort);
}

function cleanLabel(value) {
  return String(value ?? '')
    .replaceAll('<br/>', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleize(value) {
  return String(value)
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function roundNormalized(value) {
  return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}

function extend(...args) {
  let deep = false;

  if (typeof args[0] === 'boolean') {
    deep = args.shift();
  }

  const target = args.shift() ?? {};

  for (const source of args) {
    if (!source) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (deep && Array.isArray(value)) {
        target[key] = value.map((item) => (item && typeof item === 'object' ? extend(true, Array.isArray(item) ? [] : {}, item) : item));
      } else if (deep && value && typeof value === 'object') {
        target[key] = extend(true, target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
      } else {
        target[key] = value;
      }
    }
  }

  return target;
}

async function getGitRevision(repoDir) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'rev-parse', '--short', 'HEAD']);

    return stdout.trim();
  } catch {
    return 'legacy-r6maps';
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readExistingCommunityMarkers(communityDir) {
  try {
    return await readSplitCommunityMarkers(communityDir);
  } catch {
    return readJson(path.join(communityDir, 'markers.json'));
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const legacyRepoDir = path.resolve(process.argv[2] ?? '/tmp/r6maps-upstream');
  const dataDir = path.resolve(rootDir, process.argv[3] ?? 'public/data');
  const result = await importLegacyRepository({ dataDir, legacyRepoDir });

  console.log(
    `legacy import: ${result.importedMarkers} imported markers from ${result.revision}; ${result.maps} maps and ${result.markers} total markers written`,
  );
}
