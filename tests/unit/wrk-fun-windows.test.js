'use strict'

const test = require('brittle')
const fs = require('fs')
const StoreFacility = require('@tetherto/hp-svc-facs-store')
const {
  isValidWindowSpec,
  getValidWindowSpecs,
  getWindowIntervalsMs,
  sampleWindowFields,
  buildWindowEntry,
  collectWindowSamples
} = require('../../workers/lib/wrk-fun-windows')
const { getBeeTimeLog, releaseBeeTimeLog } = require('../../workers/lib/wrk-fun-logs')

const storeDir = 'tests/store-windows'
const TAG = 't-dcs'
const SPEC = { key: 'power-10s', windowMs: 10000, fields: ['site_power_w'] }

test('lib:wrk-fun-windows spec validation', async t => {
  t.ok(isValidWindowSpec(SPEC))
  t.absent(isValidWindowSpec(null))
  t.absent(isValidWindowSpec({ ...SPEC, key: 'stat-10s' }))
  t.absent(isValidWindowSpec({ ...SPEC, windowMs: 500 }))
  t.absent(isValidWindowSpec({ ...SPEC, windowMs: '10000' }))
  t.absent(isValidWindowSpec({ ...SPEC, fields: [] }))

  t.alike(getValidWindowSpecs(undefined), [])
  t.alike(getValidWindowSpecs([SPEC, { key: 'x' }]), [SPEC])
  t.alike(getWindowIntervalsMs([SPEC]), { 'power-10s': 10000 })
})

test('lib:wrk-fun-windows buildWindowEntry', async t => {
  const empty = buildWindowEntry({ start: 10000, samples: 3, fields: {} }, SPEC)
  t.alike(empty, {
    ts: 10000,
    window_ms: 10000,
    window_samples: 3,
    site_power_w_avg: null,
    site_power_w_min: null,
    site_power_w_max: null,
    site_power_w_count: 0
  })

  const full = buildWindowEntry({
    start: 20000,
    samples: 2,
    fields: { site_power_w: { sum: 30, min: 10, max: 20, count: 2 } }
  }, SPEC)
  t.is(full.site_power_w_avg, 15)
  t.is(full.site_power_w_min, 10)
  t.is(full.site_power_w_max, 20)
  t.is(full.site_power_w_count, 2)
})

test('lib:wrk-fun-windows sampleWindowFields skips unhealthy things', async t => {
  const worker = {
    mem: {
      things: {
        ok: { id: 'ok', last: { snap: { success: true, stats: { power: 5 } } } },
        failed: { id: 'failed', last: { snap: { success: false }, err: null } },
        errored: { id: 'errored', last: { snap: { success: true }, err: 'ERR' } }
      }
    },
    getSpecTags: () => ['dcs'],
    loadLib: () => ({
      specs: {
        dcs: { ops: { site_power_w: { op: 'sum', src: 'last.snap.stats.power' } } }
      }
    })
  }

  t.alike(sampleWindowFields.call(worker, SPEC, ['ok', 'failed', 'errored']), { site_power_w: 5 })
  t.alike(sampleWindowFields.call(worker, SPEC, ['failed', 'errored']), {})
})

test('lib:wrk-fun-windows collectWindowSamples', async (main) => {
  const store = new StoreFacility({}, { ns: 's0', storeDir }, { env: 'test' })
  await store.start()
  const db = await store.getBee({ name: 'main' }, { keyEncoding: 'utf-8' })
  await db.ready()

  main.teardown(async () => {
    await store.stop()
    fs.rmSync(storeDir, { recursive: true, force: true })
  })

  const samples = []
  const thing = { id: 'thg1', tags: [TAG, 'id-thg1'], last: { ts: 0 } }

  const worker = {
    ctx: {},
    conf: { thing: {} },
    mem: { log_cache: {}, things: { thg1: thing } },
    meta_logs: db.sub('meta_logs_00'),
    store_s1: store,
    windowLogSpecs: [SPEC],
    loadLib: () => ({ conf: { skipTagPrefixes: ['id-', 'code-'] } }),
    debug: () => {},
    debugError: () => {},
    getWindowSample () {
      return samples.shift()
    }
  }

  const readLog = async () => {
    const log = await getBeeTimeLog.call(worker, `${SPEC.key}-${TAG}`, 0)
    if (!log) return []
    const res = []
    for await (const chunk of log.createReadStream({})) {
      res.push(JSON.parse(chunk.value.toString()))
    }
    await releaseBeeTimeLog.call(worker, log)
    return res
  }

  const tick = async (now, sample) => {
    thing.last.ts = now
    samples.push(sample)
    await collectWindowSamples.call(worker, now)
  }

  await main.test('accumulates within a window without writing', async t => {
    await tick(100000, { site_power_w: 10 })
    await tick(101000, { site_power_w: 4 })
    await tick(102000, { site_power_w: null })
    t.alike(await readLog(), [])
  })

  await main.test('does not double count an unchanged snap', async t => {
    samples.push({ site_power_w: 1000 })
    await collectWindowSamples.call(worker, 103000)
    samples.length = 0
    t.is(worker.mem.windowLogs[SPEC.key][TAG].samples, 3)
  })

  await main.test('flushes the closed window on the next one', async t => {
    await tick(110500, { site_power_w: 8 })
    const rows = await readLog()
    t.is(rows.length, 1)
    t.alike(rows[0], {
      ts: 100000,
      window_ms: 10000,
      window_samples: 3,
      site_power_w_avg: 7,
      site_power_w_min: 4,
      site_power_w_max: 10,
      site_power_w_count: 2
    })
  })

  await main.test('writes nulls for a window with no valid values', async t => {
    await tick(121000, { site_power_w: 6 })
    await tick(125000, {})
    await tick(131000, {})
    await tick(142000, { site_power_w: 6 })
    const rows = await readLog()
    t.is(rows.length, 4)
    t.is(rows[2].ts, 120000)
    t.is(rows[2].site_power_w_avg, 6)
    t.is(rows[3].ts, 130000)
    t.is(rows[3].site_power_w_avg, null)
    t.is(rows[3].site_power_w_count, 0)
  })

  await main.test('skips windows with no samples at all', async t => {
    await tick(200000, { site_power_w: 1 })
    const rows = await readLog()
    t.is(rows.at(-1).ts, 140000)
    t.absent(rows.find(r => r.ts > 140000 && r.ts < 200000))
  })

  await main.test('no-op on slave workers', async t => {
    worker.ctx.slave = true
    await tick(300000, { site_power_w: 1 })
    worker.ctx.slave = false
    t.is(worker.mem.windowLogs[SPEC.key][TAG].start, 200000)
  })
})
