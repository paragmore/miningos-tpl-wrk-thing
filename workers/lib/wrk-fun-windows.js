'use strict'

const lWrkFunLogs = require('./wrk-fun-logs')
const lWrkFunStats = require('./wrk-fun-stats')

const MIN_WINDOW_MS = 1000

function isValidWindowSpec (spec) {
  return !!(
    spec && typeof spec.key === 'string' && spec.key &&
    !spec.key.startsWith('stat-') &&
    Number.isInteger(spec.windowMs) && spec.windowMs >= MIN_WINDOW_MS &&
    Array.isArray(spec.fields) && spec.fields.length
  )
}

function getValidWindowSpecs (specs) {
  if (!Array.isArray(specs)) {
    return []
  }

  return specs.filter(isValidWindowSpec)
}

function getWindowIntervalsMs (specs) {
  return Object.fromEntries(specs.map(spec => [spec.key, spec.windowMs]))
}

function getTagThingIds () {
  const lLibStats = this.loadLib('stats')
  const skipTagPfxs = lLibStats?.conf?.skipTagPrefixes || []
  const tags = {}

  Object.values(this.mem.things).forEach(thg => {
    thg.tags.forEach(tag => {
      if (skipTagPfxs.find(p => tag.startsWith(p))) {
        return
      }

      if (!tags[tag]) {
        tags[tag] = []
      }

      tags[tag].push(thg.id)
    })
  })

  return tags
}

function isHealthyThing (thg) {
  const last = thg?.last

  return !!(last?.snap && last.snap.success !== false && !last.err)
}

function sampleWindowFields (spec, thgIds) {
  const healthy = thgIds.filter(id => isHealthyThing(this.mem.things[id]))

  if (!healthy.length) {
    return {}
  }

  const acc = lWrkFunStats.aggrStats.call(this, healthy)
  const res = {}

  for (const field of spec.fields) {
    if (Number.isFinite(acc[field])) {
      res[field] = acc[field]
    }
  }

  return res
}

function getSampleTs (thgIds) {
  let ts = 0

  for (const id of thgIds) {
    const lastTs = this.mem.things[id]?.last?.ts

    if (lastTs > ts) {
      ts = lastTs
    }
  }

  return ts
}

function createWindow (start) {
  return { start, samples: 0, lastSampleTs: 0, fields: {} }
}

function addSample (win, spec, sample) {
  win.samples++

  for (const field of spec.fields) {
    const val = sample?.[field]

    if (!Number.isFinite(val)) {
      continue
    }

    const acc = win.fields[field]

    if (!acc) {
      win.fields[field] = { sum: val, min: val, max: val, count: 1 }
      continue
    }

    acc.sum += val
    acc.count++

    if (val < acc.min) acc.min = val
    if (val > acc.max) acc.max = val
  }
}

function buildWindowEntry (win, spec) {
  const data = {
    ts: win.start,
    window_ms: spec.windowMs,
    window_samples: win.samples
  }

  for (const field of spec.fields) {
    const acc = win.fields[field]

    data[`${field}_avg`] = acc ? acc.sum / acc.count : null
    data[`${field}_min`] = acc ? acc.min : null
    data[`${field}_max`] = acc ? acc.max : null
    data[`${field}_count`] = acc ? acc.count : 0
  }

  return data
}

async function flushWindow (spec, tag, win) {
  if (!win.samples) {
    return
  }

  await lWrkFunLogs.saveLogData.call(
    this,
    `${spec.key}-${tag}`,
    win.start,
    buildWindowEntry(win, spec),
    0,
    true
  )
}

async function collectWindowSamples (now) {
  const specs = this.windowLogSpecs

  if (this.ctx.slave || !specs?.length) {
    return
  }

  if (!this.mem.windowLogs) {
    this.mem.windowLogs = {}
  }

  const tagThingIds = getTagThingIds.call(this)

  for (const spec of specs) {
    const state = this.mem.windowLogs[spec.key] || (this.mem.windowLogs[spec.key] = {})
    const windowStart = Math.floor(now / spec.windowMs) * spec.windowMs

    for (const tag of Object.keys(state)) {
      if (!tagThingIds[tag]) {
        try {
          await flushWindow.call(this, spec, tag, state[tag])
        } catch (e) {
          this.debugError(null, e)
        }
        delete state[tag]
      }
    }

    for (const [tag, thgIds] of Object.entries(tagThingIds)) {
      let win = state[tag]

      if (win && win.start !== windowStart) {
        try {
          await flushWindow.call(this, spec, tag, win)
        } catch (e) {
          this.debugError(null, e)
        }
        win = null
      }

      if (!win) {
        win = state[tag] = createWindow(windowStart)
      }

      const sampleTs = getSampleTs.call(this, thgIds)

      if (!sampleTs || sampleTs === win.lastSampleTs) {
        continue
      }

      win.lastSampleTs = sampleTs
      addSample(win, spec, this.getWindowSample(spec, thgIds, tag))
    }
  }
}

module.exports = {
  isValidWindowSpec,
  getValidWindowSpecs,
  getWindowIntervalsMs,
  sampleWindowFields,
  buildWindowEntry,
  collectWindowSamples
}
