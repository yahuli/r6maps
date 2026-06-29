import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function markerFilePathForMapId(mapId) {
  return `public/data/community/markers/${mapId}.json`;
}

export function groupMarkersByMap(markers) {
  const groups = new Map();

  for (const marker of markers) {
    const list = groups.get(marker.mapId) ?? [];
    list.push(marker);
    groups.set(marker.mapId, list);
  }

  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export async function readSplitCommunityMarkers(communityDir) {
  const { errors, markers } = await readSplitCommunityMarkerFiles(communityDir);

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return markers;
}

export async function readSplitCommunityMarkerFiles(communityDir) {
  const markersDir = path.join(communityDir, 'markers');
  const indexPath = path.join(markersDir, 'index.json');
  const errors = [];
  let mapIds = [];
  let markerJsonFiles = [];

  if (await fileExists(path.join(communityDir, 'markers.json'))) {
    errors.push('public/data/community/markers.json must not exist after marker split');
  }

  try {
    markerJsonFiles = (await readdir(markersDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    errors.push(`public/data/community/markers directory could not be read: ${error.message}`);
  }

  try {
    const parsed = await readJson(indexPath);

    if (!Array.isArray(parsed) || parsed.some((mapId) => typeof mapId !== 'string' || mapId.trim() === '')) {
      errors.push('public/data/community/markers/index.json must be an array of map ids');
    } else {
      mapIds = parsed;
    }
  } catch (error) {
    errors.push(`public/data/community/markers/index.json could not be read: ${error.message}`);
    return { errors, mapIds, markers: [] };
  }

  const sortedUniqueMapIds = [...new Set(mapIds)].sort((left, right) => left.localeCompare(right));
  if (mapIds.length !== sortedUniqueMapIds.length || mapIds.some((mapId, index) => mapId !== sortedUniqueMapIds[index])) {
    errors.push('public/data/community/markers/index.json must be sorted and unique');
  }

  const expectedMarkerFiles = new Set(['index.json', ...mapIds.map((mapId) => `${mapId}.json`)]);
  const actualMarkerFiles = new Set(markerJsonFiles);

  for (const fileName of markerJsonFiles) {
    if (!expectedMarkerFiles.has(fileName)) {
      errors.push(`public/data/community/markers/${fileName} is not listed in markers/index.json`);
    }
  }

  for (const mapId of mapIds) {
    if (!actualMarkerFiles.has(`${mapId}.json`)) {
      errors.push(`public/data/community/markers/${mapId}.json is listed in markers/index.json but file is missing`);
    }
  }

  const markers = [];
  for (const mapId of mapIds) {
    if (!actualMarkerFiles.has(`${mapId}.json`)) {
      continue;
    }

    const markerFile = path.join(markersDir, `${mapId}.json`);

    try {
      const fileMarkers = await readJson(markerFile);

      if (!Array.isArray(fileMarkers)) {
        errors.push(`public/data/community/markers/${mapId}.json must contain a marker array`);
        continue;
      }

      for (const marker of fileMarkers) {
        if (marker?.mapId !== mapId) {
          errors.push(`marker ${marker?.id ?? '(missing id)'} in public/data/community/markers/${mapId}.json has mapId ${marker?.mapId}`);
        }
      }

      markers.push(...fileMarkers);
    } catch (error) {
      errors.push(`public/data/community/markers/${mapId}.json could not be read: ${error.message}`);
    }
  }

  return { errors, mapIds, markers };
}

export async function writeSplitCommunityMarkers(communityDir, markers) {
  const markersDir = path.join(communityDir, 'markers');
  const groups = groupMarkersByMap(markers);

  await rm(markersDir, { recursive: true, force: true });
  await mkdir(markersDir, { recursive: true });
  await writeJson(path.join(markersDir, 'index.json'), Array.from(groups.keys()));

  for (const [mapId, mapMarkers] of groups) {
    await writeJson(path.join(markersDir, `${mapId}.json`), mapMarkers);
  }

  await rm(path.join(communityDir, 'markers.json'), { force: true });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
