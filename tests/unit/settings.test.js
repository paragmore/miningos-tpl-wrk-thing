'use strict'

const test = require('brittle')
const WrkProcVar = require('../../workers/rack.thing.wrk')

function protoWorker () {
  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = { rack: 'test-rack' }
  worker.conf = { thing: {} }
  worker.settingsData = null
  worker.settings = {
    get: async () => worker.settingsData,
    put: async (_key, value) => {
      worker.settingsData = { value }
    }
  }
  return worker
}

test('getWrkSettings: save multiple settings', async t => {
  const w = protoWorker()
  const updated = await w.saveWrkSettings({
    entries: { test1: 'test1', test2: 'test2' }
  })
  t.is(updated.test1, 'test1')
  t.is(updated.test2, 'test2')
  const settings = await w.getWrkSettings()
  t.is(settings.test1, 'test1')
  t.is(settings.test2, 'test2')
})

test('saveWrkSettings: ignore empty entries', async t => {
  const w = protoWorker()
  await w.saveWrkSettings({ entries: { test1: 'test1', test2: 'test2' } })
  const updated = await w.saveWrkSettings({ entries: {} })
  t.is(updated.test1, 'test1')
  t.is(updated.test2, 'test2')
  const settings = await w.getWrkSettings()
  t.is(settings.test1, 'test1')
  t.is(settings.test2, 'test2')
})

test('saveWrkSettings: handle invalid entries', async t => {
  const w = protoWorker()
  await t.exception(async () => {
    await w.saveWrkSettings({ entries: 'invalid' })
  })
  await t.exception(async () => {
    await w.saveWrkSettings({ entries: 123 })
  })
  await t.exception(async () => {
    await w.saveWrkSettings({ entries: null })
  })
})
