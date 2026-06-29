import type { CommunityMarker } from '../types'

export async function loadCommunityMarkers(
  fetchJson: <T>(path: string) => Promise<T>,
): Promise<CommunityMarker[]> {
  const mapIds = await fetchJson<string[]>('data/community/markers/index.json')
  const markerGroups = await Promise.all(
    mapIds.map((mapId) => fetchJson<CommunityMarker[]>(`data/community/markers/${mapId}.json`)),
  )

  return markerGroups.flat()
}
