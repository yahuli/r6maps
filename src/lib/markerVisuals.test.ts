import assert from 'node:assert/strict'
import test from 'node:test'
import {
  R6CALLS_EDIT_SYMBOL_TYPES,
  R6CALLS_LEGEND_MARKER_TYPES,
  R6CALLS_MARKER_TYPE_ORDER,
  hasR6CallsEditSymbol,
} from './markerVisuals'

test('all r6calls marker types have real edit symbols and view legend entries', () => {
  assert.equal(R6CALLS_MARKER_TYPE_ORDER.length, 20)
  assert.deepEqual([...R6CALLS_EDIT_SYMBOL_TYPES], R6CALLS_MARKER_TYPE_ORDER)
  assert.deepEqual(R6CALLS_LEGEND_MARKER_TYPES, R6CALLS_MARKER_TYPE_ORDER)

  for (const markerType of R6CALLS_MARKER_TYPE_ORDER) {
    assert.equal(hasR6CallsEditSymbol(markerType), true)
  }
})
