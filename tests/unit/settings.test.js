'use strict'

const test = require('brittle')
const fs = require('fs')
const { createWorker } = require('@tetherto/tether-svc-test-helper').worker

const storeDir = `${process.cwd()}/store`

test('settings: Test Settings', async main => {
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

  thgWorker.statTimeframes = []
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

  await main.test('getWrkSettings: save multiple settings', async (t) => {
    const updtedSettings = await thgWorker.saveWrkSettings({
      entries: {
        test1: 'test1',
        test2: 'test2'
      }
    })
    t.is(updtedSettings.test1, 'test1')
    t.is(updtedSettings.test2, 'test2')
    const settings = await thgWorker.getWrkSettings()
    t.is(settings.test1, 'test1')
    t.is(settings.test2, 'test2')
  })

  await main.test('saveWrkSettings: ignore empty entries', async (t) => {
    const updtedSettings = await thgWorker.saveWrkSettings({ entries: {} })
    t.is(updtedSettings.test1, 'test1')
    t.is(updtedSettings.test2, 'test2')
    const settings = await thgWorker.getWrkSettings()
    t.is(settings.test1, 'test1')
    t.is(settings.test2, 'test2')
  })

  await main.test('saveWrkSettings: handle invalid entries', async (t) => {
    await t.exception(async () => {
      await thgWorker.saveWrkSettings({ entries: 'invalid' })
    })
    await t.exception(async () => {
      await thgWorker.saveWrkSettings({ entries: 123 })
    })
    await t.exception(async () => {
      await thgWorker.saveWrkSettings({ entries: null })
    })
  })
})
