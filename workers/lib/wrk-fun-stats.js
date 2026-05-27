const utilsStore = require('@tetherto/hp-svc-facs-store/utils')
const gLibStats = require('@tetherto/miningos-lib-stats')
const lWrkFunLogs = require('./wrk-fun-logs')

function aggrStats (thgIds, opts = {}, thgs = null) {
  const result = {}
  const lLibStats = this.loadLib('stats')
  const specs = lLibStats.specs

  this.getSpecTags().forEach(stype => {
    if (!specs[stype]) {
      return
    }

    const state = {}
    state.ops = specs[stype].ops
    const acc = {}

    for (const thgId of thgIds) {
      const thg = thgs?.[thgId] || this.mem.things[thgId]
      if (!thg) continue
      const last = thg.last || {}
      const info = thg.info || {}
      gLibStats.applyStats(
        state,
        acc,
        { last, info },
        { id: thg.id, tags: thg.tags, info, opts: thg.opts, type: thg.type }
      )
    }

    gLibStats.tallyStats(state, acc)
    Object.assign(result, acc)
  })

  return result
}

async function _buildStats (logKey, fireTime) {
  const now = Math.floor(fireTime.getTime() / 1000) * 1000 // NOTE: get the proper tick time based on when the scheduler was to fire

  const tagSpecs = {}
  const thgIdsAll = Object.keys(this.mem.things)
  const lLibStats = this.loadLib('stats')
  const skipTagPfxs = lLibStats.conf.skipTagPrefixes || []

  thgIdsAll.forEach(thgId => {
    const thg = this.mem.things[thgId]

    thg.tags.forEach(tag => {
      if (skipTagPfxs.find(p => tag.startsWith(p))) {
        return
      }

      if (!tagSpecs[tag]) {
        tagSpecs[tag] = { thgIds: [] }
      }

      const tagSpec = tagSpecs[tag]
      tagSpec.thgIds.push(thgId)
    })
  })

  const tags = Object.keys(tagSpecs)

  for await (const tag of tags) {
    const tagSpec = tagSpecs[tag]

    const acc = aggrStats.call(this, tagSpec.thgIds)
    const log = await lWrkFunLogs.getBeeTimeLog.call(this, `${logKey}-${tag}`, 0, true)

    try {
      await log.put(
        utilsStore.convIntToBin(now),
        Buffer.from(JSON.stringify({
          ts: now,
          ...acc
        }))
      )
    } catch (e) {
      this.debugError(null, e)
    }

    await lWrkFunLogs.releaseBeeTimeLog.call(this, log)
  }
}

async function buildStats (logKey, fireTime) {
  if (this.ctx.slave) {
    return
  }

  const lLibStats = this.loadLib('stats')

  if (!lLibStats) {
    return
  }

  const lkr = `_buildingStats_${logKey}`

  if (this[lkr]) {
    return
  }

  this[lkr] = true

  await _buildStats.call(this, logKey, fireTime)

  this[lkr] = false
}

module.exports = {
  aggrStats,
  buildStats
}
