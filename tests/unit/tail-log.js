'use strict'

const test = require('brittle')
const fs = require('fs')
const path = require('path')
const StoreFacility = require('@tetherto/hp-svc-facs-store')
const WrkProcVar = require('../../workers/rack.thing.wrk')
const { rotateLogs } = require('../../workers/lib/wrk-fun-logs')

const getRounded5MinTimeWithOffset = offset => {
  const time = new Date()
  time.setUTCMinutes(Math.floor(time.getUTCMinutes() / 5) * 5)
  time.setUTCSeconds(0)
  time.setUTCMilliseconds(0)
  time.setUTCMinutes(time.getUTCMinutes() - offset * 5)
  return time
}

function stopStore (store) {
  return new Promise((resolve, reject) => {
    store.stop(err => (err ? reject(err) : resolve()))
  })
}

function protoWorker (extra = {}) {
  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = { rack: 'test-rack' }
  worker.conf = {
    thing: {
      logKeepCount: 3,
      logRotateMaxLength: 5
    }
  }
  worker.mem = {
    things: {
      miner1: {
        id: 'miner1',
        tags: ['t-miner'],
        last: {
          alerts: [{ uuid: 1, severity: 'medium' }],
          snap: { stats: { status: 'mining' } }
        }
      }
    },
    log_cache: {}
  }
  worker.rackId = 'thing-test-rack'
  worker.statTimeframes = [['5m', '0 */5 * * * *']]
  worker.debug = () => {}
  worker.debugError = () => {}
  worker.loadLib = type => {
    if (type === 'stats') {
      return {
        specs: {
          miner: {
            ops: {
              alerts_cnt: {
                op: 'alerts_group_cnt',
                src: 'last.alerts'
              }
            }
          }
        },
        conf: {}
      }
    }
    return null
  }
  worker.getSpecTags = () => ['miner']
  Object.assign(worker, extra)
  return worker
}

test('tailLog: Test tailLog', async main => {
  const storeDir = path.join(process.cwd(), 'tail-log')
  const store = new StoreFacility({}, { ns: 's0', storeDir }, { env: 'test' })
  await store.start()
  const db = await store.getBee({ name: 'main' }, { keyEncoding: 'utf-8' })
  await db.ready()

  const w = protoWorker({
    store_s1: store,
    meta_logs: db.sub('meta_logs_00')
  })

  main.teardown(async () => {
    await stopStore(store)
    fs.rmSync(storeDir, { recursive: true, force: true })
  })

  for (let index = 0; index < 200; index++) {
    const time = getRounded5MinTimeWithOffset(index)
    await w.buildStats('stat-5m', time)
    if (index === 4 + (index + 1) * 5) {
      await rotateLogs.bind(w)()
    }
  }

  await main.test('tailLog: fetches data from offset with limit', async t => {
    const resp = await w.tailLog({
      key: 'stat-5m',
      type: 'miner',
      tag: 't-miner',
      limit: 10
    })
    t.is(resp.length, 10)
  })

  await main.test('tailLog: fetches data with correct limit', async t => {
    const resp = await w.tailLog({
      key: 'stat-5m',
      type: 'miner',
      tag: 't-miner',
      limit: 5
    })
    t.is(resp.length, 5)
  })

  await main.test(
    'tailLog: fetches max 100 data if limit is not passed',
    async t => {
      const resp = await w.tailLog({
        key: 'stat-5m',
        type: 'miner',
        tag: 't-miner'
      })
      t.is(resp.length, 100)
    }
  )

  await main.test(
    'tailLog: fetches correct data with start and end timestamps',
    async t => {
      const resp = await w.tailLog({
        key: 'stat-5m',
        type: 'miner',
        tag: 't-miner',
        end: getRounded5MinTimeWithOffset(2).getTime(),
        start: getRounded5MinTimeWithOffset(9).getTime()
      })
      t.is(resp.length, 8)
    }
  )

  await main.test(
    'tailLog: fetches correct data from start of log to end timestamp if start timestamp and limit are not passed',
    async t => {
      const resp = await w.tailLog({
        key: 'stat-5m',
        type: 'miner',
        tag: 't-miner',
        end: getRounded5MinTimeWithOffset(2).getTime()
      })
      t.is(resp.length, 198)
    }
  )

  await main.test(
    'tailLog: fetches correct data from start timestamp to current time if end timestamp and limit are not passed',
    async t => {
      const resp = await w.tailLog({
        key: 'stat-5m',
        type: 'miner',
        tag: 't-miner',
        start: getRounded5MinTimeWithOffset(10).getTime()
      })
      t.is(resp.length, 11)
    }
  )

  await main.test(
    'tailLog: fetches correct data with start and end timestamps',
    async t => {
      const resp = await w.tailLog({
        key: 'stat-5m',
        type: 'miner',
        tag: 't-miner',
        end: getRounded5MinTimeWithOffset(0).getTime(),
        start: getRounded5MinTimeWithOffset(99).getTime()
      })
      t.is(resp.length, 100)
    }
  )
})
