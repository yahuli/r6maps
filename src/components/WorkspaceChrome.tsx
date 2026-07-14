import {
  Columns2,
  Crosshair,
  Eye,
  Layers3,
  Maximize2,
  Pencil,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { KeyboardEvent } from 'react'

export type InspectorTab = 'markers' | 'layers' | 'changes'

export function WorkspaceModeSwitch({
  canEdit,
  compact,
  labels,
  onChange,
}: {
  canEdit: boolean
  compact: boolean
  labels: { browse: string; edit: string }
  onChange: (editing: boolean) => void
}) {
  return (
    <div className="mode-switch" aria-label={`${labels.browse} / ${labels.edit}`}>
      <button
        aria-pressed={!canEdit}
        className={!canEdit ? 'selected' : ''}
        type="button"
        onClick={() => onChange(false)}
      >
        <Eye size={15} />
        <span>{labels.browse}</span>
      </button>
      {!compact && (
        <button
          aria-pressed={canEdit}
          className={canEdit ? 'selected' : ''}
          type="button"
          onClick={() => onChange(true)}
        >
          <Pencil size={15} />
          <span>{labels.edit}</span>
        </button>
      )}
    </div>
  )
}

export function InspectorTabs({
  active,
  labels,
  onChange,
}: {
  active: InspectorTab
  labels: Record<InspectorTab, string>
  onChange: (tab: InspectorTab) => void
}) {
  const tabs = Object.keys(labels) as InspectorTab[]

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: InspectorTab) {
    const currentIndex = tabs.indexOf(tab)
    let nextIndex = currentIndex

    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1
    } else {
      return
    }

    event.preventDefault()
    const nextTab = tabs[nextIndex]
    onChange(nextTab)
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-inspector-tab="${nextTab}"]`)
      ?.focus()
  }

  return (
    <div className="inspector-tabs" role="tablist" aria-label="Editor inspector" aria-orientation="horizontal">
      {tabs.map((tab) => (
        <button
          aria-controls="inspector-panel"
          aria-selected={active === tab}
          className={active === tab ? 'selected' : ''}
          data-inspector-tab={tab}
          id={`inspector-tab-${tab}`}
          key={tab}
          role="tab"
          tabIndex={active === tab ? 0 : -1}
          type="button"
          onKeyDown={(event) => handleKeyDown(event, tab)}
          onClick={() => onChange(tab)}
        >
          {labels[tab]}
        </button>
      ))}
    </div>
  )
}

export function WorkspaceToolRail({
  canDelete,
  compact,
  editing,
  legendOpen,
  referenceActive,
  splitView,
  labels,
  onDelete,
  onInspectorLayers,
  onLegendToggle,
  onReferenceClear,
  onReset,
  onSplitToggle,
  onZoomIn,
  onZoomOut,
}: {
  canDelete: boolean
  compact: boolean
  editing: boolean
  legendOpen: boolean
  referenceActive: boolean
  splitView: boolean
  labels: {
    clearReference: string
    deleteMarker: string
    layers: string
    legend: string
    reset: string
    split: string
    zoomIn: string
    zoomOut: string
  }
  onDelete: () => void
  onInspectorLayers: () => void
  onLegendToggle: () => void
  onReferenceClear: () => void
  onReset: () => void
  onSplitToggle: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}) {
  return (
    <div className="workspace-tool-rail" role="toolbar" aria-label="Map workspace tools">
      <button
        aria-pressed={splitView}
        className={splitView ? 'active' : ''}
        title={labels.split}
        type="button"
        onClick={onSplitToggle}
      >
        <Columns2 size={19} />
      </button>
      <button title={labels.reset} type="button" onClick={onReset}>
        <Maximize2 size={19} />
      </button>
      {compact && (
        <>
          <button title={labels.zoomOut} type="button" onClick={onZoomOut}>
            <ZoomOut size={19} />
          </button>
          <button title={labels.zoomIn} type="button" onClick={onZoomIn}>
            <ZoomIn size={19} />
          </button>
        </>
      )}
      {editing ? (
        <button title={labels.layers} type="button" onClick={onInspectorLayers}>
          <Layers3 size={19} />
        </button>
      ) : (
        <button
          aria-pressed={legendOpen}
          className={legendOpen ? 'active' : ''}
          title={labels.legend}
          type="button"
          onClick={onLegendToggle}
        >
          <Layers3 size={19} />
        </button>
      )}
      <button disabled={!referenceActive} title={labels.clearReference} type="button" onClick={onReferenceClear}>
        <Crosshair size={19} />
      </button>
      {editing && (
        <button
          className="danger"
          disabled={!canDelete}
          title={labels.deleteMarker}
          type="button"
          onClick={onDelete}
        >
          <Trash2 size={19} />
        </button>
      )}
    </div>
  )
}
