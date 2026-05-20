'use strict'

const test = require('brittle')
const fs = require('fs')
const { rotateLogs } = require('../../workers/lib/wrk-fun-logs')
const { createWorker } = require('@tetherto/tether-svc-test-helper').worker

const storeDir = `${process.cwd()}/store`

const getRounded5MinTimeWithOffset = offset => {
  const time = new Date()
  time.setMinutes(Math.floor(time.getMinutes() / 5) * 5)
  time.setSeconds(0)
  time.setMilliseconds(0)
  time.setMinutes(time.getMinutes() - offset * 5)
  return time
}

test('tailLog: Test tailLog', async main => {
  const workerConfig = {
    env: 'development',
    wtype: 'wrk-thing-rack',
    rack: 'test-log',
    serviceRoot: process.cwd()
  }

  const worker = createWorker(workerConfig)
  await worker.start()
  const thgWorker = worker.worker

  main.teardown(async () => {
    await worker.stop()
    // delete test store dir after tests complete
    fs.rmSync(storeDir, { recursive: true, force: true })
  })

  thgWorker.conf.thing = {
    logKeepCount: 3,
    logRotateMaxLength: 5
  }
  thgWorker.mem.things = {
    miner1: {
      id: 'miner1',
      tags: ['t-miner'],
      last: {
        alerts: [{ uuid: 1, severity: 'medium' }],
        snap: {
          stats: {
            status: 'mining'
          }
        }
      }
    }
  }
  thgWorker.loadLib = () => ({
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
  })
  thgWorker.getSpecTags = () => ['miner']

  for (let index = 0; index < 200; index++) {
    const time = getRounded5MinTimeWithOffset(index)
    await thgWorker.buildStats('stat-5m', time)
    if (index === 4 + (index + 1) * 5) {
      await rotateLogs.bind(thgWorker)()
    }
  }

  await main.test('tailLog: fetches data from offset with limit', async t => {
    const resp = await thgWorker.tailLog({
      key: 'stat-5m',
      type: 'miner',
      tag: 't-miner',
      limit: 10
    })
    t.ok(resp.length === 10)
  })

  await main.test('tailLog: fetches data with correct limit', async t => {
    const resp = await thgWorker.tailLog({
      key: 'stat-5m',
      type: 'miner',
      tag: 't-miner',
      limit: 5
    })
    t.ok(resp.length === 5)
  })

  await main.test(
    'tailLog: fetches max 100 data if limit is not passed',
    async t => {
      const resp = await thgWorker.tailLog({
        key: 'stat-5m',
        type: 'miner',
        tag: 't-miner'
      })
      t.ok(resp.length === 100)
    }
  )

  await main.test(
    'tailLog: fetches correct data with start and end timestamps',
    async t => {
      const resp = await thgWorker.tailLog({
        key: 'stat-5m',
        type: 'miner',
        tag: 't-miner',
        end: getRounded5MinTimeWithOffset(2).getTime(),
        start: getRounded5MinTimeWithOffset(9).getTime()
      })
      t.ok(resp.length === 8)
    }
  )

  await main.test(
    'tailLog: fetches correct data from start of log to end timestamp if start timestamp and limit are not passed',
    async t => {
      const resp = await thgWorker.tailLog({
        key: 'stat-5m',
        type: 'miner',
        tag: 't-miner',
        end: getRounded5MinTimeWithOffset(2).getTime()
      })
      t.ok(resp.length === 198)
    }
  )

  await main.test(
    'tailLog: fetches correct data from start timestamp to current time if end timestamp and limit are not passed',
    async t => {
      const resp = await thgWorker.tailLog({
        key: 'stat-5m',
        type: 'miner',
        tag: 't-miner',
        start: getRounded5MinTimeWithOffset(10).getTime()
      })
      t.ok(resp.length === 11)
    }
  )

  await main.test(
    'tailLog: fetches correct data with start and end timestamps',
    async t => {
      const resp = await thgWorker.tailLog({
        key: 'stat-5m',
        type: 'miner',
        tag: 't-miner',
        end: getRounded5MinTimeWithOffset(0).getTime(),
        start: getRounded5MinTimeWithOffset(99).getTime()
      })
      t.ok(resp.length === 100)
    }
  )
})
