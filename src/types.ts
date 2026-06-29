export type MarkerType =
  | 'camera'
  | 'ceiling-hatch'
  | 'text-label'
  | 'spawn'
  | 'skylight'
  | 'vertical-route'
  | 'ladder'
  | 'bomb'
export type MarkerDirection = 'up' | 'down'
export type MarkerStatus = 'published' | 'proposed' | 'deprecated'
export type TranslationEntity = 'map' | 'marker' | 'floor'
export type TranslationField = 'name' | 'label'

export interface LocaleInfo {
  id: string
  name: string
  nativeName: string
}

export type UiMessages = Record<string, Record<string, string>>

export interface MapFloor {
  id: string
  name: string
  sort: number
  image?: string
}

export interface OfficialMap {
  id: string
  name: string
  status: 'official' | 'legacy'
  season: string
  source:
    | {
        provider: 'ubisoft'
        url: string
        blueprintZip: string
        checksum: string
        lastModified: string
      }
    | {
        provider: 'r6maps-legacy'
        url: string
        revision: string
        importedAt: string
      }
  floors: MapFloor[]
}

export interface CommunityMarker {
  id: string
  mapId: string
  floorId: string
  type: MarkerType
  label: string
  x: number
  y: number
  siteNumber?: number
  siteLetter?: 'A' | 'B'
  spawnNumber?: number
  spawnName?: string
  direction?: MarkerDirection
  size?: number
  rotation?: number
  source: 'official' | 'community'
  status: MarkerStatus
}

export interface TranslationEntry {
  entityType: TranslationEntity
  entityId: string
  field: TranslationField
  locale: string
  value: string
  status: MarkerStatus
}

export interface DraftMarker {
  mapId: string
  floorId: string
  type: MarkerType
  label: string
  x: number
  y: number
  siteNumber?: number
  siteLetter?: 'A' | 'B'
  spawnNumber?: number
  spawnName?: string
  direction?: MarkerDirection
  size?: number
  rotation?: number
}
