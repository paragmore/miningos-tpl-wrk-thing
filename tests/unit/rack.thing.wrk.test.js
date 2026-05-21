'use strict'

const test = require('brittle')
const TetherWrkBase = require('@tetherto/tether-wrk-base/workers/base.wrk.tether')
const WrkProcVar = require('../../workers/rack.thing.wrk')
const lWrkFunLogs = require('../../workers/lib/wrk-fun-logs')
const lWrkFunReplica = require('../../workers/lib/wrk-fun-replica')
const { STAT_RTD, RPC_METHODS } = require('../../workers/lib/constants')

test('WrkProcVar: getThingType', async t => {
  // Create a minimal instance for testing
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  // Mock the parent constructor behavior
  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.prefix = 'wrk-thing-rack-test-rack'

  const result = worker.getThingType()
  t.is(result, 'thing')
})

test('WrkProcVar: getThingTags', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf

  const result = worker.getThingTags()
  t.alike(result, [])
})

test('WrkProcVar: selectThingInfo', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf

  const result = worker.selectThingInfo()
  t.alike(result, {})
})

test('WrkProcVar: _getWrkExtData', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf

  const result = worker._getWrkExtData({ test: 'args' })
  t.alike(result, {})
})

test('WrkProcVar: _generateThingId', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf

  const result = worker._generateThingId()
  t.ok(typeof result === 'string')
  t.ok(result.length > 0)
})

test('WrkProcVar: _getMaxThingCode with no things', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = { things: {} }

  const result = worker._getMaxThingCode()
  t.is(result, 0)
})

test('WrkProcVar: _getMaxThingCode with things', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = {
    things: {
      thing1: { code: 'THING-0001' },
      thing2: { code: 'THING-0005' },
      thing3: { code: 'THING-0003' }
    }
  }

  const result = worker._getMaxThingCode()
  t.is(result, 5)
})

test('WrkProcVar: _generateThingCode', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = { things: {} }

  const result = worker._generateThingCode({})
  t.ok(result.startsWith('THING-'))
  t.ok(result.endsWith('0001'))
})

test('WrkProcVar: _generateThingCode with seed', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = { things: {} }

  const result = worker._generateThingCode({}, 42)
  t.ok(result.startsWith('THING-'))
  t.ok(result.endsWith('0042'))
})

test('WrkProcVar: queryThing - should throw ERR_THING_NOTFOUND when thing does not exist', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = { things: {} }

  try {
    await worker.queryThing({ id: 'non-existent-thing', method: 'testMethod', params: [] })
    t.fail('Should have thrown ERR_THING_NOTFOUND')
  } catch (error) {
    t.is(error.message, 'ERR_THING_NOTFOUND')
  }
})

test('WrkProcVar: queryThing - should throw ERR_THING_NOT_INITIALIZED when ctrl is null', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = {
    things: {
      'thing-1': {
        id: 'thing-1',
        ctrl: null
      }
    }
  }

  try {
    await worker.queryThing({ id: 'thing-1', method: 'testMethod', params: [] })
    t.fail('Should have thrown ERR_THING_NOT_INITIALIZED')
  } catch (error) {
    t.is(error.message, 'ERR_THING_NOT_INITIALIZED')
  }
})

test('WrkProcVar: queryThing - should throw ERR_THING_NOT_INITIALIZED when ctrl is undefined', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = {
    things: {
      'thing-1': {
        id: 'thing-1'
        // ctrl is undefined
      }
    }
  }

  try {
    await worker.queryThing({ id: 'thing-1', method: 'testMethod', params: [] })
    t.fail('Should have thrown ERR_THING_NOT_INITIALIZED')
  } catch (error) {
    t.is(error.message, 'ERR_THING_NOT_INITIALIZED')
  }
})

test('WrkProcVar: queryThing - should throw ERR_THING_METHOD_NOTFOUND when method does not exist', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = {
    things: {
      'thing-1': {
        id: 'thing-1',
        ctrl: {
          existingMethod: async () => 'result'
        }
      }
    }
  }

  try {
    await worker.queryThing({ id: 'thing-1', method: 'nonExistentMethod', params: [] })
    t.fail('Should have thrown ERR_THING_METHOD_NOTFOUND')
  } catch (error) {
    t.is(error.message, 'ERR_THING_METHOD_NOTFOUND')
  }
})

test('WrkProcVar: queryThing - should successfully call method with no params', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = {
    things: {
      'thing-1': {
        id: 'thing-1',
        ctrl: {
          testMethod: async () => {
            return { success: true, data: 'test-result' }
          }
        }
      }
    }
  }

  const result = await worker.queryThing({ id: 'thing-1', method: 'testMethod', params: [] })
  t.alike(result, { success: true, data: 'test-result' })
})

test('WrkProcVar: queryThing - should successfully call method with params', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = {
    things: {
      'thing-1': {
        id: 'thing-1',
        ctrl: {
          testMethod: async (param1, param2) => {
            return { param1, param2, sum: param1 + param2 }
          }
        }
      }
    }
  }

  const result = await worker.queryThing({ id: 'thing-1', method: 'testMethod', params: [10, 20] })
  t.alike(result, { param1: 10, param2: 20, sum: 30 })
})

test('WrkProcVar: queryThing - should pass ctrl as this context to method', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf

  const mockCtrl = {
    value: 42,
    testMethod: async function () {
      return this.value
    }
  }

  worker.mem = {
    things: {
      'thing-1': {
        id: 'thing-1',
        ctrl: mockCtrl
      }
    }
  }

  const result = await worker.queryThing({ id: 'thing-1', method: 'testMethod', params: [] })
  t.is(result, 42)
})

test('WrkProcVar: queryThing - should handle method that throws error', async t => {
  const conf = { thing: {} }
  const ctx = { rack: 'test-rack' }

  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = {
    things: {
      'thing-1': {
        id: 'thing-1',
        ctrl: {
          testMethod: async () => {
            throw new Error('Method execution error')
          }
        }
      }
    }
  }

  try {
    await worker.queryThing({ id: 'thing-1', method: 'testMethod', params: [] })
    t.fail('Should have thrown error from method')
  } catch (error) {
    t.is(error.message, 'Method execution error')
  }
})

function protoWorker (extra = {}) {
  const conf = { thing: { thingQueryConcurrency: 4, logKeepCount: 3 } }
  const ctx = { rack: 'test-rack' }
  const worker = Object.create(WrkProcVar.prototype)
  worker.ctx = ctx
  worker.conf = conf
  worker.mem = { things: {}, log_cache: {}, collectingThingSnap: {} }
  worker.rackId = 'thing-test-rack'
  worker.net_r0 = { rpcServer: { publicKey: Buffer.from([1, 2, 3]) } }
  worker.statTimeframes = [['5m', '0 */5 * * * *']]
  // Class field: only exists on real instances, not the prototype chain.
  worker._registerAndStoreThing = async function (data) {
    data.id = data.id ?? worker._generateThingId()
    const thgId = data.id
    const code = data.code ?? worker._generateThingCode(data)
    const tags = worker._prepThingTags({ ...data, code }, data.tags)
    const thg = {
      id: thgId,
      opts: data.opts,
      info: data.info,
      code,
      tags,
      comments: data.comments
    }
    await worker.registerThingHook0(thg)
    await worker._storeThingDb(thg)
    worker.mem.nextAvailableCode = worker._generateThingCode(thg)
    return thg
  }
  Object.assign(worker, extra)
  return worker
}

test('WrkProcVar: _getOfflineSnap', async t => {
  const w = protoWorker()
  const snap = w._getOfflineSnap()
  t.is(snap.success, false)
  t.is(snap.stats.status, 'offline')
})

test('WrkProcVar: getRpcKey and getRack', async t => {
  const w = protoWorker()
  t.alike(w.getRpcKey(), Buffer.from([1, 2, 3]))
  const rack = w.getRack({})
  t.is(rack.id, 'thing-test-rack')
  t.is(rack.rpcPubKey, '010203')
})

test('WrkProcVar: debug helpers', async t => {
  const w = protoWorker()
  w.debugThingError({ id: 't1' }, new Error('e'))
  w.debugError('ctx', new Error('e2'))
  w.debug('msg')
  t.pass()
})

test('WrkProcVar: disconnectThing closes ctrl when present', async t => {
  const w = protoWorker()
  let closed = false
  await w.disconnectThing({ ctrl: { close: () => { closed = true } } })
  t.ok(closed)
  await w.disconnectThing({ ctrl: {} })
  t.pass()
})

test('WrkProcVar: reconnectThing', async t => {
  const w = protoWorker()
  w.disconnectThing = async () => {}
  w.connectThing = async () => {}
  await w.reconnectThing({ ctrl: { close: () => {} } })
  t.pass()
})

test('WrkProcVar: _prepThingTags', async t => {
  const w = protoWorker()
  const tags = w._prepThingTags(
    { id: 'i1', code: 'THING-0001', info: { pos: 'p1', container: 'c1' } },
    ['aux-a'],
    { tags: ['keep-me'] }
  )
  t.ok(tags.includes('id-i1'))
  t.ok(tags.includes('code-THING-0001'))
  t.ok(tags.includes('aux-a'))
  t.ok(tags.includes('keep-me'))
  t.ok(tags.includes('pos-p1'))
  t.ok(tags.includes('container-c1'))
})

test('WrkProcVar: _prepThingTags rejects invalid aux', async t => {
  const w = protoWorker()
  try {
    w._prepThingTags({ id: 'i', code: 'C' }, 'not-array')
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_THING_TAGS_INVALID')
  }
})

test('WrkProcVar: _validateRegisterThing', async t => {
  const w = protoWorker()
  w.mem.things = { x: { id: 'x' } }
  try {
    w._validateRegisterThing({ id: 'x' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_THING_WITH_ID_ALREADY_EXISTS')
  }
  try {
    w._validateRegisterThing({ code: 'BAD' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_THING_CODE_INVALID')
  }
  w.mem.things = { a: { code: 'THING-0001' } }
  try {
    w._validateRegisterThing({ code: 'THING-0001' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_THING_WITH_CODE_ALREADY_EXISTS')
  }
})

test('WrkProcVar: _validateThingExists and _checkWriteAccessToThing', async t => {
  const w = protoWorker()
  try {
    w._validateThingExists('nope')
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_THING_NOTFOUND')
  }
  w.mem.things = { t1: { id: 't1' } }
  w._validateThingExists('t1')
  w.ctx.slave = true
  try {
    w._checkWriteAccessToThing({ thingId: 't1' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_SLAVE_BLOCK')
  }
  w.ctx.slave = false
  w._checkWriteAccessToThing({ thingId: 't1' })
  try {
    w._checkWriteAccessToThing({ thingId: 'missing' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_THING_NOTFOUND')
  }
})

test('WrkProcVar: _findCommentIndex and _checkCommentPermission', async t => {
  const w = protoWorker()
  const thg = {
    comments: [
      { id: 'c1', ts: 10, user: 'u1' },
      { id: 'c2', ts: 20, user: 'u2' }
    ]
  }
  t.is(w._findCommentIndex(thg, { id: 'c2' }), 1)
  t.is(w._findCommentIndex(thg, { ts: 10 }), 0)
  t.is(w._findCommentIndex(thg, {}), -1)
  try {
    w._checkCommentPermission(thg, 0, { user: 'other' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_COMMENT_ACCESS_DENIED')
  }
  w._checkCommentPermission(thg, 0, { user: 'u1' })
  t.pass()
})

test('WrkProcVar: listThings and getThingsCount', async t => {
  const w = protoWorker()
  w.mem.things = {
    a: {
      id: 'a',
      code: 'THING-0001',
      type: 'thing',
      tags: [],
      info: { n: 1 },
      comments: [],
      last: { snap: { x: 1 } }
    },
    b: {
      id: 'b',
      code: 'THING-0002',
      type: 'thing',
      tags: [],
      info: { n: 2 },
      comments: []
    }
  }
  t.is(w.getThingsCount({}), 2)
  t.is(w.getThingsCount({ query: { 'info.n': 2 } }), 1)
  const listed = w.listThings({ offset: 0, limit: 10, status: true })
  t.is(listed.length, 2)
  t.ok(listed[0].last)
})

test('WrkProcVar: _applyFilters sort offset limit', async t => {
  const w = protoWorker()
  const things = [
    { id: 'b', info: { ord: 'item-2' } },
    { id: 'a', info: { ord: 'item-10' } }
  ]
  const sorted = w._applyFilters(things, { sort: { 'info.ord': 1 }, offset: 0, limit: 1 }, true)
  t.is(sorted.length, 1)
  t.is(sorted[0].id, 'b')
})

test('WrkProcVar: _projection', async t => {
  const w = protoWorker()
  const out = w._projection([{ a: 1, b: 2 }], { a: 1 })
  t.ok(Array.isArray(out))
  t.is(out[0].a, 1)
  t.absent(out[0].b)
})

test('WrkProcVar: _transformAlerts and _transformInfoHistory', async t => {
  const w = protoWorker()
  w.mem.things = {
    t1: { id: 't1', info: { x: 1 }, tags: ['t'], type: 'thing', code: 'C1' }
  }
  const alerts = w._transformAlerts(
    [{ u1: { thingId: 't1', msg: 'a' } }],
    { limit: 5 }
  )
  t.is(alerts.length, 1)
  t.is(alerts[0].thing.id, 't1')
  const hist = w._transformInfoHistory(
    [[{ id: 't1', changes: {} }]],
    { limit: 5, fields: {} }
  )
  t.is(hist.length, 1)
})

test('WrkProcVar: _parseHistLog', async t => {
  const w = protoWorker()
  const log = {
    createReadStream () {
      return (async function * () {
        yield { value: Buffer.from(JSON.stringify({ z: 9 })) }
      })()
    }
  }
  const rows = await w._parseHistLog(log, { reverse: true, limit: 5 })
  t.is(rows.length, 1)
  t.is(rows[0].z, 9)
})

test('WrkProcVar: applyThings', async t => {
  const w = protoWorker()
  w._handler = WrkProcVar.prototype._createApplyThingsProxy.call(w)
  w.mem.things = {
    t1: { id: 't1', ctrl: { ping: async () => 7 } }
  }
  const n = await w.applyThings({ method: 'ping', params: [] })
  t.is(n, 1)
})

test('WrkProcVar: applyThings slave blocks', async t => {
  const w = protoWorker()
  w.ctx.slave = true
  try {
    await w.applyThings({ method: 'm' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_SLAVE_BLOCK')
  }
})

test('WrkProcVar: applyThings requires method', async t => {
  const w = protoWorker()
  try {
    await w.applyThings({})
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_METHOD_INVALID')
  }
})

test('WrkProcVar: saveThingComment', async t => {
  const w = protoWorker()
  w.ctx.slave = false
  w.mem.things = { t1: { id: 't1' } }
  w.things = {
    get: async () => ({
      value: Buffer.from(JSON.stringify({ id: 't1', comments: [] }))
    }),
    put: async () => {}
  }
  w._saveThing = async () => {}
  await w.saveThingComment({
    thingId: 't1',
    user: 'u',
    comment: 'hi',
    pos: 1
  })
  t.pass()
})

test('WrkProcVar: editThingComment and deleteThingComment', async t => {
  const w = protoWorker()
  w.ctx.slave = false
  w.mem.things = { t1: { id: 't1' } }
  let stored = {
    id: 't1',
    comments: [{ id: 'c1', ts: 1, user: 'u', comment: 'old' }]
  }
  w.things = {
    get: async () => ({
      value: Buffer.from(JSON.stringify(stored))
    }),
    put: async (_id, buf) => {
      stored = JSON.parse(buf.toString())
    }
  }
  w._saveThing = async (thg) => {
    stored = JSON.parse(JSON.stringify(thg))
    await w.things.put(thg.id, Buffer.from(JSON.stringify(stored)))
  }
  await w.editThingComment({ thingId: 't1', user: 'u', id: 'c1', comment: 'new' })
  t.is(stored.comments[0].comment, 'new')
  await w.deleteThingComment({ thingId: 't1', user: 'u', id: 'c1' })
  t.is(stored.comments.length, 0)
})

test('WrkProcVar: forgetThings with all', async t => {
  const w = protoWorker()
  w.ctx.slave = false
  w.mem.things = { t1: { id: 't1' } }
  w.things = { del: async () => {} }
  w.forgetThingHook0 = async () => {}
  await w.forgetThings({ all: true })
  t.absent(w.mem.things.t1)
})

test('WrkProcVar: getWrkExtData and getWrkConf', async t => {
  const w = protoWorker()
  t.alike(await w.getWrkExtData({}), {})
  try {
    await w.getWrkConf({})
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_GLOBAL_CONFIG_MISSING')
  }
  w.conf.globalConfig = { k: 1 }
  const cfg = await w.getWrkConf({ fields: {} })
  t.is(cfg.k, 1)
})

test('WrkProcVar: getThingConf', async t => {
  const w = protoWorker()
  w.mem.nextAvailableCode = 'THING-0099'
  const code = await w.getThingConf({ requestType: 'nextAvailableCode' })
  t.is(code, 'THING-0099')
  try {
    await w.getThingConf({ requestType: 'other' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_INVALID_REQUEST_TYPE')
  }
})

test('WrkProcVar: saveWrkSettings validates entries', async t => {
  const w = protoWorker()
  try {
    await w.saveWrkSettings({})
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_ENTRIES_INVALID')
  }
})

test('WrkProcVar: getHistoricalLogs rejects missing type', async t => {
  const w = protoWorker()
  try {
    await w.getHistoricalLogs({})
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_INFO_HISTORY_LOG_TYPE_INVALID')
  }
})

test('WrkProcVar: tailLog validates key and tag', async t => {
  const w = protoWorker()
  try {
    await w.tailLog({})
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_LOG_KEY_NOTFOUND')
  }
  try {
    await w.tailLog({ key: 'k' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_LOG_TAG_INVALID')
  }
})

test('WrkProcVar: registerThing slave blocks', async t => {
  const w = protoWorker()
  w.ctx.slave = true
  try {
    await w.registerThing({})
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_SLAVE_BLOCK')
  }
})

test('WrkProcVar: updateThing slave blocks', async t => {
  const w = protoWorker()
  w.ctx.slave = true
  try {
    await w.updateThing({ id: 'x' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_SLAVE_BLOCK')
  }
})

test('WrkProcVar: forgetThings slave blocks', async t => {
  const w = protoWorker()
  w.ctx.slave = true
  try {
    await w.forgetThings({})
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_SLAVE_BLOCK')
  }
})

test('WrkProcVar: collectSnaps returns early on slave', async t => {
  const w = protoWorker()
  w.ctx.slave = true
  await w.collectSnaps()
  t.pass()
})

test('WrkProcVar: loadLib loads project workers/lib module', async t => {
  const path = require('path')
  const w = protoWorker()
  w.ctx.root = path.join(__dirname, '../..')
  const lib = w.loadLib('base')
  t.ok(lib)
})

test('WrkProcVar: loadLib returns null for missing module', async t => {
  const w = protoWorker()
  w.ctx.root = require('path').join(__dirname, '../..')
  const lib = w.loadLib('nonexistent-module-xyz')
  t.is(lib, null)
})

test('WrkProcVar: saveThingData updates mem', async t => {
  const w = protoWorker()
  w.mem.things = {
    t1: { id: 't1', opts: {}, info: {}, tags: [], comments: [] }
  }
  w._saveThingDataToDb = async () => {}
  await w.saveThingData({ id: 't1', opts: { z: 9 } })
  t.is(w.mem.things.t1.opts.z, 9)
})

test('WrkProcVar: updateThing merges info and comment', async t => {
  const w = protoWorker()
  w.ctx.slave = false
  let db = {
    id: 't1',
    code: 'THING-0001',
    opts: { o: 1 },
    info: { a: 1 },
    tags: ['id-t1', 'code-THING-0001'],
    comments: []
  }
  w.mem.things = {
    t1: { id: 't1', code: 'THING-0001', opts: {}, info: {}, tags: [], comments: [], last: {} }
  }
  w.things = {
    get: async () => ({ value: Buffer.from(JSON.stringify(db)) }),
    put: async (_id, buf) => {
      db = JSON.parse(buf.toString())
    }
  }
  w.updateThingHook0 = async () => {}
  w.reconnectThing = async () => {}
  await w.updateThing({
    id: 't1',
    info: { b: 2 },
    user: 'alice',
    comment: 'note'
  })
  t.is(db.info.b, 2)
  t.is(db.info.a, 1)
  t.is(db.comments.length, 1)
  t.is(db.comments[0].user, 'alice')
})

test('WrkProcVar: _filterThings with query', async t => {
  const w = protoWorker()
  w.mem.things = {
    x: { id: 'x', info: { n: 1 } },
    y: { id: 'y', info: { n: 2 } }
  }
  const ids = w._filterThings({ query: { 'info.n': 2 } })
  t.is(ids.length, 1)
  t.is(ids[0], 'y')
})

test('WrkProcVar: _addWhitelistedActions', async t => {
  const w = protoWorker()
  let called = null
  w.miningosThgWriteCalls_0 = {
    whitelistActions: (a) => { called = a }
  }
  w._addWhitelistedActions([['a', 1]])
  t.alike(called, [['a', 1]])
})

test('WrkProcVar: editThingComment errors', async t => {
  const w = protoWorker()
  w.ctx.slave = false
  w.mem.things = { t1: { id: 't1' } }
  w.things = {
    get: async () => ({
      value: Buffer.from(JSON.stringify({ id: 't1', comments: 'bad' }))
    })
  }
  try {
    await w.editThingComment({ thingId: 't1', user: 'u', id: 'c' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_THING_COMMENTS_NOTFOUND')
  }
})

test('WrkProcVar: editThingComment not found', async t => {
  const w = protoWorker()
  w.ctx.slave = false
  w.mem.things = { t1: { id: 't1' } }
  w.things = {
    get: async () => ({
      value: Buffer.from(JSON.stringify({ id: 't1', comments: [] }))
    })
  }
  try {
    await w.editThingComment({ thingId: 't1', user: 'u', id: 'missing' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_THING_COMMENT_NOTFOUND')
  }
})

test('WrkProcVar: setupThing returns 0 when thing already in mem', async t => {
  const w = protoWorker()
  w.mem.things = { t1: { id: 't1' } }
  const r = await w.setupThing({ id: 't1' })
  t.is(r, 0)
})

test('WrkProcVar: setupThings with empty DB stream', async t => {
  const w = protoWorker()
  w.things = {
    createReadStream () {
      return (async function * () {})()
    }
  }
  w._assignCodesToThings = async () => {}
  await w.setupThings()
  t.pass()
})

test('WrkProcVar: _getTailLogWithOffset single fetch when no range match and no limit', async t => {
  const w = protoWorker()
  w.statTimeframes = [['5m', '0 */5 * * * *']]
  let calls = 0
  w._getLogResponse = async () => {
    calls++
    return [{ v: 1 }]
  }
  const out = await w._getTailLogWithOffset({
    key: 'stat-unknown-key',
    tag: 'miner',
    start: 1,
    end: 2
  }, 0)
  t.is(calls, 1)
  t.is(out.length, 1)
})

test('WrkProcVar: _getTailLogWithOffset continues after partial error', async t => {
  const w = protoWorker()
  w.conf.thing.logKeepCount = 5
  w.statTimeframes = [['5m', '0 */5 * * * *']]
  let n = 0
  w._getLogResponse = async () => {
    n++
    if (n === 1) return [{ a: 1 }]
    throw new Error('eof')
  }
  const out = await w._getTailLogWithOffset({
    key: 'stat-5m',
    tag: 'miner',
    limit: 5
  }, 0)
  t.ok(out.length >= 1)
})

test('WrkProcVar: _parseHistLog applies range and limit options', async t => {
  const w = protoWorker()
  const log = {
    createReadStream (q) {
      t.ok(q)
      return (async function * () {
        yield { value: Buffer.from(JSON.stringify({ ok: true })) }
      })()
    }
  }
  const rows = await w._parseHistLog(log, {
    start: 100,
    end: 200,
    startExcl: 50,
    endExcl: 300,
    limit: 5,
    reverse: true
  })
  t.is(rows.length, 1)
})

test('WrkProcVar: tailLog with groupRange', async t => {
  const w = protoWorker()
  w._getTailLogWithOffset = async () => [
    { ts: 1_700_000_000_000, v: 10 },
    { ts: 1_700_000_000_000 + 3600_000, v: 20 }
  ]
  w.tailLogHook0 = async () => {}
  const out = await w.tailLog({
    key: 'stat-5m',
    tag: 'miner',
    groupRange: '1H',
    shouldCalculateAvg: false
  })
  t.ok(Array.isArray(out))
  t.ok(out.length >= 1)
})

test('WrkProcVar: tailLog with fields projection', async t => {
  const w = protoWorker()
  w._getTailLogWithOffset = async () => [{ ts: 1, a: 1, b: 2 }]
  w.tailLogHook0 = async () => {}
  const out = await w.tailLog({
    key: 'stat-5m',
    tag: 'miner',
    fields: { a: 1 }
  })
  t.ok(Array.isArray(out))
  t.is(out[0].a, 1)
  t.absent(out[0].b)
})

test('WrkProcVar: deleteThingComment permission denied', async t => {
  const w = protoWorker()
  w.ctx.slave = false
  w.mem.things = { t1: { id: 't1' } }
  w.things = {
    get: async () => ({
      value: Buffer.from(JSON.stringify({
        id: 't1',
        comments: [{ id: 'c1', ts: 1, user: 'owner', comment: 'x' }]
      }))
    })
  }
  try {
    await w.deleteThingComment({ thingId: 't1', user: 'other', id: 'c1' })
    t.fail()
  } catch (e) {
    t.is(e.message, 'ERR_COMMENT_ACCESS_DENIED')
  }
})

test('WrkProcVar: forgetThings default empty query', async t => {
  const w = protoWorker()
  w.ctx.slave = false
  await w.forgetThings({})
  t.pass()
})

test('WrkProcVar: getHistoricalLogs alerts', async t => {
  const w = protoWorker()
  w.mem.things = {
    t1: { id: 't1', info: { n: 1 }, tags: ['x'], type: 'thing', code: 'C1' }
  }
  w._getLogs = async (req, logKey, errMsg, transformFn) => {
    return transformFn([{ u1: { thingId: 't1', createdAt: 1, uuid: 'u1' } }], req)
  }
  const out = await w.getHistoricalLogs({ logType: 'alerts', limit: 10 })
  t.ok(Array.isArray(out))
  t.is(out[0].thing.id, 't1')
})

test('WrkProcVar: getHistoricalLogs info', async t => {
  const w = protoWorker()
  w.mem.things = {
    t1: { id: 't1', info: { n: 1 }, tags: [], type: 'thing', code: 'C1' }
  }
  w._getLogs = async (req, logKey, errMsg, transformFn) => {
    return transformFn([[{ id: 't1', changes: { a: 1 }, ts: 1 }]], req)
  }
  const out = await w.getHistoricalLogs({
    logType: 'info',
    limit: 10,
    offset: 0
  })
  t.ok(Array.isArray(out))
  t.ok(out.length >= 1)
})

test('WrkProcVar: forgetThings removes things matching query', async t => {
  const w = protoWorker()
  w.ctx.slave = false
  w.mem.things = {
    a: { id: 'a', info: { zone: 'z1' } },
    b: { id: 'b', info: { zone: 'z2' } }
  }
  w.things = { del: async () => {} }
  w.forgetThingHook0 = async () => {}
  await w.forgetThings({ query: { 'info.zone': 'z1' } })
  t.absent(w.mem.things.a)
  t.ok(w.mem.things.b)
})

test('WrkProcVar: _storeInfoChangesToDb appends history', async t => {
  const w = protoWorker()
  let putCount = 0
  w._getInfoHistoryLog = async () => ({
    get: async () => null,
    put: async () => {
      putCount++
    },
    close: async () => {},
    discoveryKey: Buffer.from('ab', 'hex')
  })
  w.debugError = () => {}
  await w._storeInfoChangesToDb(
    { info: { a: 1 } },
    { id: 't1', info: { a: 2 } }
  )
  t.is(putCount, 1)
})

// --- Audit logging tests ---

function mockLogger () {
  const calls = { info: [], warn: [] }
  return {
    calls,
    info: (obj, msg) => calls.info.push({ obj, msg }),
    warn: (obj, msg) => calls.warn.push({ obj, msg })
  }
}

test('WrkProcVar: loggerMixin returns rackId', async t => {
  const w = protoWorker()
  const mixin = w.loggerMixin()
  t.alike(mixin, { rackId: 'thing-test-rack' })
})

test('WrkProcVar: _auditLog skips when logger is not available', async t => {
  const w = protoWorker()
  w._auditLog('registerThing', {})
  t.pass()
})

test('WrkProcVar: _auditLog emits success audit event', async t => {
  const logger = mockLogger()
  const w = protoWorker()
  w.logger = logger

  w._auditLog('registerThing', { user: 'admin@test.com', id: 't1' }, {
    detail: { thingId: 't1', code: 'MINER-0001' }
  })

  t.is(logger.calls.info.length, 1)
  const entry = logger.calls.info[0]
  t.is(entry.obj.audit, true)
  t.is(entry.obj.action, 'registerThing')
  t.is(entry.obj.outcome, 'success')
  t.is(entry.obj.user, 'admin@test.com')
  t.is(entry.obj.thingId, 't1')
  t.alike(entry.obj.detail, { thingId: 't1', code: 'MINER-0001' })
  t.is(entry.msg, 'audit: registerThing success')
})

test('WrkProcVar: _auditLog emits failure audit event', async t => {
  const logger = mockLogger()
  const w = protoWorker()
  w.logger = logger

  w._auditLog('forgetThings', { user: 'u@test.com' }, {
    outcome: 'failure',
    error: 'ERR_SLAVE_BLOCK'
  })

  t.is(logger.calls.warn.length, 1)
  const entry = logger.calls.warn[0]
  t.is(entry.obj.audit, true)
  t.is(entry.obj.action, 'forgetThings')
  t.is(entry.obj.outcome, 'failure')
  t.is(entry.obj.error, 'ERR_SLAVE_BLOCK')
  t.is(entry.msg, 'audit: forgetThings failure')
})

test('WrkProcVar: _auditLog extracts thingId from req.thingId', async t => {
  const logger = mockLogger()
  const w = protoWorker()
  w.logger = logger

  w._auditLog('saveThingComment', { thingId: 'device-42', user: 'u' }, {
    detail: { thingId: 'device-42' }
  })

  t.is(logger.calls.info[0].obj.thingId, 'device-42')
})

test('WrkProcVar: _auditLog defaults user and thingId to null', async t => {
  const logger = mockLogger()
  const w = protoWorker()
  w.logger = logger

  w._auditLog('rackReboot', {}, { detail: {} })

  const entry = logger.calls.info[0]
  t.is(entry.obj.user, null)
  t.is(entry.obj.thingId, null)
})

function auditedWorker (logger) {
  const w = protoWorker()
  w.logger = logger
  w.net_r0.parseInputJSON = (x) => x
  w.net_r0.toOutJSON = (x) => x
  return w
}

test('WrkProcVar: handleRpcReply emits audit log for registerThing', async t => {
  const logger = mockLogger()
  const w = auditedWorker(logger)
  w.ctx.slave = false
  w.mem.things = {}
  w._validateRegisterThing = () => {}
  w._registerAndStoreThing = async (data) => ({ id: data.id, code: data.code })
  w.setupThing = async () => {}

  await w.handleRpcReply('registerThing', {
    user: 'admin@test.com',
    id: 't1',
    code: 'THING-0001',
    info: {}
  })

  t.is(logger.calls.info.length, 1)
  t.is(logger.calls.info[0].obj.action, 'registerThing')
  t.is(logger.calls.info[0].obj.detail.thingId, 't1')
  t.is(logger.calls.info[0].obj.detail.code, 'THING-0001')
})

test('WrkProcVar: handleRpcReply emits audit log for forgetThings', async t => {
  const logger = mockLogger()
  const w = auditedWorker(logger)
  w.ctx.slave = false
  w.mem.things = { t1: { id: 't1' } }
  w.things = { del: async () => {} }
  w.forgetThingHook0 = async () => {}

  await w.handleRpcReply('forgetThings', { all: true })

  t.is(logger.calls.info.length, 1)
  t.is(logger.calls.info[0].obj.action, 'forgetThings')
  t.is(logger.calls.info[0].obj.detail.all, true)
})

test('WrkProcVar: handleRpcReply emits audit log for applyThings with affected count', async t => {
  const logger = mockLogger()
  const w = auditedWorker(logger)
  w._handler = WrkProcVar.prototype._createApplyThingsProxy.call(w)
  w.mem.things = {
    t1: { id: 't1', ctrl: { ping: async () => 7 } }
  }

  await w.handleRpcReply('applyThings', { method: 'ping', params: [] })

  t.is(logger.calls.info.length, 1)
  t.is(logger.calls.info[0].obj.action, 'applyThings')
  t.is(logger.calls.info[0].obj.detail.method, 'ping')
  t.is(logger.calls.info[0].obj.detail.affected, 1)
})

test('WrkProcVar: handleRpcReply emits audit log for saveWrkSettings', async t => {
  const logger = mockLogger()
  const w = auditedWorker(logger)
  w.settings = {
    get: async () => ({ value: JSON.stringify({}) }),
    put: async () => {}
  }

  await w.handleRpcReply('saveWrkSettings', { entries: { autoSleep: true } })

  t.is(logger.calls.info.length, 1)
  t.is(logger.calls.info[0].obj.action, 'saveWrkSettings')
  t.alike(logger.calls.info[0].obj.detail.entryKeys, ['autoSleep'])
})

test('WrkProcVar: handleRpcReply emits audit log for rackReboot', async t => {
  const logger = mockLogger()
  const w = auditedWorker(logger)
  w.stop = () => {}

  await w.handleRpcReply('rackReboot', {})

  t.is(logger.calls.info.length, 1)
  t.is(logger.calls.info[0].obj.action, 'rackReboot')
})

test('WrkProcVar: handleRpcReply emits failure audit on method error', async t => {
  const logger = mockLogger()
  const w = auditedWorker(logger)
  w.registerThing = async () => { throw new Error('ERR_BOOM') }

  await w.handleRpcReply('registerThing', { user: 'u', id: 't1' })

  t.is(logger.calls.warn.length, 1)
  t.is(logger.calls.warn[0].obj.action, 'registerThing')
  t.is(logger.calls.warn[0].obj.outcome, 'failure')
  t.is(logger.calls.warn[0].obj.error, 'ERR_BOOM')
})

test('WrkProcVar: handleRpcReply emits failure audit when parseInputJSON throws', async t => {
  const logger = mockLogger()
  const w = protoWorker()
  w.logger = logger
  w.net_r0.parseInputJSON = () => { throw new Error('ERR_PARSE') }
  w.net_r0.toOutJSON = (x) => x

  await w.handleRpcReply('registerThing', Buffer.from('bogus'))

  t.is(logger.calls.warn.length, 1)
  t.is(logger.calls.warn[0].obj.outcome, 'failure')
  t.is(logger.calls.warn[0].obj.error, 'ERR_PARSE')
})

test('WrkProcVar: _auditLog swallows logger errors to not block rpc', async t => {
  const w = protoWorker()
  w.logger = {
    info: () => { throw new Error('ERR_LOGGER_DOWN') },
    warn: () => { throw new Error('ERR_LOGGER_DOWN') }
  }
  w.debugError = () => {}

  w._auditLog('registerThing', { id: 't1' }, { detail: {} })
  t.pass('did not throw')
})

function patchBeeTimeLog (mockLog) {
  const origGet = lWrkFunLogs.getBeeTimeLog
  const origRelease = lWrkFunLogs.releaseBeeTimeLog
  lWrkFunLogs.getBeeTimeLog = async () => mockLog
  lWrkFunLogs.releaseBeeTimeLog = async () => {}
  return () => {
    lWrkFunLogs.getBeeTimeLog = origGet
    lWrkFunLogs.releaseBeeTimeLog = origRelease
  }
}

async function runCollectSnap (w, thg, thingConf) {
  await w._collectSnap(thg, thingConf)
  const deadline = Date.now() + 200
  while (thg.last.snap === undefined && thg.last.err === undefined && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('WrkProcVar: _getAuditDetail covers audit switch cases', async t => {
  const w = protoWorker()
  t.alike(w._getAuditDetail('updateThing', { forceOverwrite: true, actionId: 'a1' }), {
    forceOverwrite: true,
    actionId: 'a1'
  })
  t.alike(w._getAuditDetail('saveThingComment', { thingId: 't1' }), { thingId: 't1' })
  t.alike(w._getAuditDetail('editThingComment', { thingId: 't1', id: 'c1' }), {
    thingId: 't1',
    commentId: 'c1'
  })
  t.alike(w._getAuditDetail('deleteThingComment', { thingId: 't1', ts: 99 }), {
    thingId: 't1',
    commentId: 99
  })
  t.alike(w._getAuditDetail('forgetThings', { query: { id: 't1' }, all: true }), {
    query: { id: 't1' },
    all: true
  })
  t.alike(w._getAuditDetail('unknownMethod', {}), {})
})

test('WrkProcVar: _loadOptionalConfigs skips missing configs', async t => {
  const w = protoWorker()
  w.loadConf = () => { throw new Error('missing') }
  w.debug = () => {}
  w._loadOptionalConfigs()
  t.pass()
})

test('WrkProcVar: _storeInfoChangesToDb logs put errors', async t => {
  const w = protoWorker()
  w._getInfoHistoryLog = async () => ({
    get: async () => null,
    put: async () => { throw new Error('put fail') },
    discoveryKey: Buffer.alloc(32)
  })
  w.debugError = () => {}
  await w._storeInfoChangesToDb({ info: { a: 1 } }, { id: 't1', info: { a: 2 } })
  t.pass()
})

test('WrkProcVar: updateThingHook0 swallows store errors', async t => {
  const w = protoWorker()
  w._storeInfoChangesToDb = async () => { throw new Error('db fail') }
  w.debugError = () => {}
  await w.updateThingHook0({ id: 't1', info: {} }, { id: 't1', info: {} })
  t.pass()
})

test('WrkProcVar: _collectSnap skips when already collecting', async t => {
  const w = protoWorker()
  w.mem.collectingThingSnap = { t1: { isCollectingSnap: true } }
  let called = false
  w.collectThingSnap = async () => { called = true }
  await w._collectSnap({ id: 't1', last: {} }, w.conf.thing)
  t.is(called, false)
})

test('WrkProcVar: _collectSnap maintenance mode uses offline snap', async t => {
  const w = protoWorker({
    conf: { thing: { storeSnapItvMs: 0, collectSnapRetry: 1, collectSnapTimeoutMs: 5000 } }
  })
  w.loadLib = () => null
  w._storeThingSnap = async () => {}
  const thg = { id: 't1', info: { container: 'maintenance' }, last: {} }
  await runCollectSnap(w, thg, w.conf.thing)
  t.is(thg.last.snap.success, false)
  t.is(thg.last.snap.stats.status, 'offline')
})

test('WrkProcVar: _collectSnap collects from ctrl', async t => {
  const snap = { success: true, stats: { status: 'ok' } }
  const origCollect = WrkProcVar.prototype.collectThingSnap
  WrkProcVar.prototype.collectThingSnap = async () => snap
  try {
    const w = protoWorker({
      conf: { thing: { storeSnapItvMs: 0, collectSnapRetry: 1, collectSnapTimeoutMs: 5000 } }
    })
    w.loadLib = () => null
    w._storeThingSnap = async () => {}
    const thg = { id: 't1', info: {}, last: {}, ctrl: {} }
    await runCollectSnap(w, thg, w.conf.thing)
    t.is(thg.last.snap, snap)
  } finally {
    WrkProcVar.prototype.collectThingSnap = origCollect
  }
})

test('WrkProcVar: _collectSnap timeout uses offline snap', async t => {
  const origCollect = WrkProcVar.prototype.collectThingSnap
  WrkProcVar.prototype.collectThingSnap = async () => {
    await new Promise(resolve => setTimeout(resolve, 50))
    return { success: true, stats: {} }
  }
  try {
    const w = protoWorker({
      conf: { thing: { storeSnapItvMs: 0, collectSnapRetry: 1, collectSnapTimeoutMs: 5 } }
    })
    w.loadLib = () => null
    w._storeThingSnap = async () => {}
    const thg = { id: 't1', info: {}, last: {}, ctrl: {} }
    await runCollectSnap(w, thg, w.conf.thing)
    t.is(thg.last.snap.success, false)
  } finally {
    WrkProcVar.prototype.collectThingSnap = origCollect
  }
})

test('WrkProcVar: _collectSnap connection failure when no ctrl', async t => {
  const w = protoWorker({
    conf: { thing: { storeSnapItvMs: 0, collectSnapRetry: 1, collectSnapTimeoutMs: 5000 } }
  })
  w.connectThing = async () => {}
  w.loadLib = () => null
  w._storeThingSnap = async () => {}
  const thg = { id: 't1', info: {}, last: {} }
  await runCollectSnap(w, thg, w.conf.thing)
  t.is(thg.last.err, 'ERR_THING_CONNECTION_FAILURE')
})

test('WrkProcVar: _collectSnap records non-timeout collect errors', async t => {
  const origCollect = WrkProcVar.prototype.collectThingSnap
  WrkProcVar.prototype.collectThingSnap = async () => { throw new Error('ERR_DEVICE') }
  try {
    const w = protoWorker({
      conf: { thing: { storeSnapItvMs: 0, collectSnapRetry: 1, collectSnapTimeoutMs: 5000 } }
    })
    w.loadLib = () => null
    w._storeThingSnap = async () => {}
    w.debugThingError = () => {}
    const thg = { id: 't1', info: {}, last: {}, ctrl: {} }
    await runCollectSnap(w, thg, w.conf.thing)
    t.is(thg.last.err, 'ERR_DEVICE')
  } finally {
    WrkProcVar.prototype.collectThingSnap = origCollect
  }
})

test('WrkProcVar: collectSnaps runs hooks and saves alerts', async t => {
  const w = protoWorker()
  let hookCalled = false
  let alertsSaved = false
  w.mem.things = { t1: { id: 't1', last: { alerts: [] } } }
  w._collectSnap = async () => {}
  w.collectSnapsHook0 = async () => { hookCalled = true }
  w._saveAlerts = async () => { alertsSaved = true }
  await w.collectSnaps()
  t.ok(hookCalled)
  t.ok(alertsSaved)
})

test('WrkProcVar: collectSnaps logs alert save errors', async t => {
  const w = protoWorker()
  w.mem.things = { t1: { id: 't1' } }
  w._collectSnap = async () => {}
  w.collectSnapsHook0 = async () => {}
  w._saveAlerts = async () => { throw new Error('save fail') }
  w.debugError = () => {}
  await w.collectSnaps()
  t.pass()
})

test('WrkProcVar: setupThing loads last snap from log on master', async t => {
  const restore = patchBeeTimeLog({
    peek: async () => ({
      value: Buffer.from(JSON.stringify({ snap: { ok: 1 }, ts: 1, err: null }))
    }),
    discoveryKey: Buffer.alloc(32)
  })
  try {
    const w = protoWorker()
    w.ctx.slave = false
    w.setupThingHook0 = async () => {}
    w.setupThingHook1 = async () => {}
    w.connectThing = async (thg) => { thg.ctrl = {} }
    const r = await w.setupThing({
      id: 't-new',
      code: 'THING-0010',
      tags: [],
      info: {},
      opts: {},
      comments: []
    })
    t.is(r, 1)
    t.is(w.mem.things['t-new'].last.snap.ok, 1)
  } finally {
    restore()
  }
})

test('WrkProcVar: setupThings forgets stale things and assigns codes', async t => {
  const w = protoWorker()
  w.mem.things = { stale: { id: 'stale' } }
  w.things = {
    createReadStream () {
      return (async function * () {
        yield {
          value: Buffer.from(JSON.stringify({
            id: 'fresh',
            code: 'THING-0002',
            tags: [],
            info: {},
            opts: {}
          }))
        }
      })()
    }
  }
  w.setupThing = async (entry) => {
    w.mem.things[entry.id] = { id: entry.id, code: entry.code, tags: entry.tags }
    return 1
  }
  w._forgetThing = async (id) => { delete w.mem.things[id] }
  w._assignCodesToThings = async () => {}
  await w.setupThings()
  t.absent(w.mem.things.stale)
  t.ok(w.mem.things.fresh)
})

test('WrkProcVar: setupThings logs setup and assign errors', async t => {
  const w = protoWorker()
  w.things = {
    createReadStream () {
      return (async function * () {
        yield { value: Buffer.from(JSON.stringify({ id: 'bad' })) }
      })()
    }
  }
  w.setupThing = async () => { throw new Error('setup fail') }
  w._assignCodesToThings = async () => { throw new Error('assign fail') }
  w.debugError = () => {}
  await w.setupThings()
  t.pass()
})

test('WrkProcVar: _assignCodesToThings assigns codes to uncoded things', async t => {
  const w = protoWorker()
  w.mem.things = {
    t1: { id: 't1', tags: [] },
    t2: { id: 't2', tags: [] }
  }
  w.things = {
    put: async () => {},
    get: async (id) => ({
      value: Buffer.from(JSON.stringify(w.mem.things[id]))
    })
  }
  await w._assignCodesToThings()
  t.ok(w.mem.things.t1.code)
  t.ok(w.mem.things.t2.code)
  t.ok(w.mem.nextAvailableCode)
})

test('WrkProcVar: _assignCodesToThings sets next code when all coded', async t => {
  const w = protoWorker()
  w.mem.things = { t1: { id: 't1', code: 'THING-0007', tags: [] } }
  await w._assignCodesToThings()
  t.ok(w.mem.nextAvailableCode.startsWith('THING-'))
})

test('WrkProcVar: registerThing with comment and info', async t => {
  const restore = patchBeeTimeLog({
    peek: async () => null,
    discoveryKey: Buffer.alloc(32)
  })
  try {
    const w = protoWorker()
    w.ctx.slave = false
    w.mem.things = {}
    let stored
    w.things = {
      put: async (id, buf) => { stored = JSON.parse(buf.toString()) }
    }
    w.registerThingHook0 = async () => {}
    w.connectThing = async (thg) => { thg.ctrl = {} }
    await w.registerThing({
      opts: { host: 'miner-1' },
      info: { rack: 'r1' },
      comment: 'installed',
      user: 'tech'
    })
    t.ok(stored)
    t.is(stored.comments.length, 1)
    t.is(stored.comments[0].user, 'tech')
    t.is(Object.keys(w.mem.things).length, 1)
  } finally {
    restore()
  }
})

test('WrkProcVar: updateThing assigns code and merges fields', async t => {
  const w = protoWorker()
  w.ctx.slave = false
  w.mem.things = { t1: { id: 't1' } }
  let stored = {
    id: 't1',
    opts: { a: 1 },
    info: { n: 1 },
    tags: ['id-t1'],
    comments: null
  }
  w.things = {
    get: async () => ({ value: Buffer.from(JSON.stringify(stored)) }),
    put: async (_id, buf) => { stored = JSON.parse(buf.toString()) }
  }
  w.updateThingHook0 = async () => {}
  w.reconnectThing = async () => {}
  await w.updateThing({
    id: 't1',
    opts: { b: 2 },
    info: { n: 2, extra: true },
    tags: ['aux-x'],
    comment: 'updated',
    user: 'u1',
    actionId: 'act-1'
  })
  t.ok(stored.code)
  t.ok(Array.isArray(stored.comments))
  t.is(stored.comments.length, 1)
  t.is(stored.info.n, 2)
})

test('WrkProcVar: _forgetThing closes ctrl and removes thing', async t => {
  const w = protoWorker()
  let closed = false
  w.mem.things = {
    t1: { id: 't1', ctrl: { close: async () => { closed = true; throw new Error('close err') } } }
  }
  w.things = { del: async () => {} }
  w.forgetThingHook0 = async () => {}
  await w._forgetThing('t1')
  t.ok(closed)
  t.absent(w.mem.things.t1)
})

test('WrkProcVar: applyThings skips non-matching things', async t => {
  const w = protoWorker()
  w._handler = WrkProcVar.prototype._createApplyThingsProxy.call(w)
  w.mem.things = {
    t1: { id: 't1', ctrl: { ping: async () => 1 } },
    t2: { id: 't2', ctrl: { ping: async () => 1 } }
  }
  const n = await w.applyThings({ method: 'ping', query: { id: 't1' }, params: [] })
  t.is(n, 1)
})

test('WrkProcVar: applyThings counts zero when handler throws', async t => {
  const w = protoWorker()
  w._handler = WrkProcVar.prototype._createApplyThingsProxy.call(w)
  w.mem.things = { t1: { id: 't1', ctrl: {} } }
  w.debugThingError = () => {}
  const n = await w.applyThings({ method: 'missingMethod', query: { id: 't1' } })
  t.is(n, 0)
})

test('WrkProcVar: applyThings proxy routes ThingLocApply methods', async t => {
  const w = protoWorker()
  w.rebootThingLocApply = async (thg) => {
    t.is(thg.id, 't1')
    return 1
  }
  w._handler = WrkProcVar.prototype._createApplyThingsProxy.call(w)
  const res = await w._handler.call(
    { method: 'rebootThingLocApply', params: [] },
    { id: 't1' }
  )
  t.is(res, 1)
})

test('WrkProcVar: _saveAlerts stores thing alerts', async t => {
  const restore = patchBeeTimeLog({
    put: async () => {},
    get: async () => null,
    discoveryKey: Buffer.alloc(32)
  })
  try {
    const w = protoWorker()
    w.mem.things = {
      t1: {
        id: 't1',
        last: {
          alerts: [{ createdAt: 1000, uuid: 'u1', name: 'heat', code: 'H1' }]
        }
      }
    }
    await w._saveAlerts()
    t.pass()
  } finally {
    restore()
  }
})

test('WrkProcVar: _storeThgAlertsToDb merges existing alerts', async t => {
  const w = protoWorker()
  const log = {
    get: async () => ({
      value: Buffer.from(JSON.stringify({ old: { thingId: 't1', uuid: 'old' } }))
    }),
    put: async () => {}
  }
  await w._storeThgAlertsToDb('t1', log, [
    { createdAt: 1000, uuid: 'u1', name: 'heat', code: 'H1' }
  ])
  t.pass()
})

test('WrkProcVar: _storeThgAlertsToDb ignores non-array alerts', async t => {
  const w = protoWorker()
  await w._storeThgAlertsToDb('t1', {}, null)
  t.pass()
})

test('WrkProcVar: _getLogs throws when parse result is not array', async t => {
  const w = protoWorker()
  const restore = patchBeeTimeLog({
    discoveryKey: Buffer.alloc(32),
    createReadStream () {
      return (async function * () {})()
    }
  })
  try {
    w._parseHistLog = async () => 'not-array'
    try {
      await w._getLogs({}, 'log-key', 'ERR_LOG', (x) => x)
      t.fail()
    } catch (e) {
      t.is(e.message, 'ERR_HIST_LOG_NOTFOUND')
    }
  } finally {
    restore()
  }
})

test('WrkProcVar: _getLogResponse throws when log missing', async t => {
  const restore = patchBeeTimeLog(null)
  try {
    const w = protoWorker()
    try {
      await w._getLogResponse({ key: 'stat', tag: 't1' }, 0)
      t.fail()
    } catch (e) {
      t.is(e.message, 'ERR_LOG_NOTFOUND')
    }
  } finally {
    restore()
  }
})

test('WrkProcVar: getHistoricalLogs info applies filters', async t => {
  const w = protoWorker()
  w.mem.things = {
    t1: { id: 't1', info: { n: 1 }, tags: [], type: 'thing', code: 'C1' },
    t2: { id: 't2', info: { n: 2 }, tags: [], type: 'thing', code: 'C2' }
  }
  w._getLogs = async (req, logKey, errMsg, transformFn) => {
    return transformFn([
      [{ id: 't1', changes: {}, ts: 1 }],
      [{ id: 't2', changes: {}, ts: 2 }]
    ], req)
  }
  const out = await w.getHistoricalLogs({
    logType: 'info',
    limit: 1,
    offset: 0,
    query: { 'thing.id': 't1' }
  })
  t.is(out.length, 1)
  t.is(out[0].thing.id, 't1')
})

test('WrkProcVar: buildStats routes stat-rtd to _saveRealTimeData', async t => {
  const w = protoWorker()
  let called = false
  w._saveRealTimeData = async () => { called = true }
  await w.buildStats(STAT_RTD, Date.now())
  t.ok(called)
})

test('WrkProcVar: _saveRealTimeData aggregates realtime snapshots', async t => {
  const restore = patchBeeTimeLog({
    put: async () => {},
    discoveryKey: Buffer.alloc(32)
  })
  try {
    const w = protoWorker({
      conf: { thing: { thingRtdConcurrency: 2 } }
    })
    w._getThingBaseType = () => 'thing'
    w.loadLib = () => null
    w.debugThingError = () => {}
    w.mem.things = {
      t1: {
        id: 't1',
        ctrl: { getRealtimeData: async () => ({ success: true, stats: { h: 1 } }) }
      },
      t2: { id: 't2' },
      t3: {
        id: 't3',
        ctrl: { getRealtimeData: async () => { throw new Error('rtd fail') } }
      }
    }
    await w._saveRealTimeData()
    await new Promise(resolve => setTimeout(resolve, 50))
    t.is(w._collectingRtd, false)
  } finally {
    restore()
  }
})

test('WrkProcVar: _saveRealTimeData skips when already collecting', async t => {
  const w = protoWorker()
  w._collectingRtd = true
  w.mem.things = {
    t1: { id: 't1', ctrl: { getRealtimeData: async () => ({}) } }
  }
  await w._saveRealTimeData()
  t.pass()
})

test('WrkProcVar: getDbMeta lists main and log cores', async t => {
  const restore = patchBeeTimeLog({
    core: { key: Buffer.from('aa', 'hex') },
    discoveryKey: Buffer.alloc(32)
  })
  try {
    const w = protoWorker({
      db: { core: { key: Buffer.from('bb', 'hex') } },
      meta_logs: {
        createReadStream () {
          return (async function * () {
            yield {
              key: 'thing-alerts',
              value: Buffer.from(JSON.stringify({ cur: 0 }))
            }
          })()
        }
      }
    })
    const keys = await w.getDbMeta()
    t.ok(keys.length >= 2)
    t.is(keys[0].name, 'main')
  } finally {
    restore()
  }
})

test('WrkProcVar: rackReboot stops worker', async t => {
  const w = protoWorker()
  let stopped = false
  w.stop = (cb) => {
    stopped = true
    // Do not invoke cb — production cb calls process.exit(-1).
  }
  const r = w.rackReboot({})
  t.is(r, 1)
  t.ok(stopped)
})

function createMockDb () {
  const sub = {
    get: async () => null,
    put: async () => {},
    del: async () => {},
    createReadStream () {
      return (async function * () {})()
    }
  }
  return {
    ready: async () => {},
    core: { key: Buffer.from('aabbccdd', 'hex') },
    sub: () => sub
  }
}

function buildStartWorker (extra = {}) {
  const db = createMockDb()
  const intervalAdds = []
  const schedulerAdds = []
  const rpcHandlers = {}
  const w = protoWorker({
    ctx: { rack: 'test-rack', slave: false, root: process.cwd() },
    conf: {
      thing: {
        scheduleAddlStatTfs: [['1h', '0 0 */1 * * *']],
        scheduleAddlStatConfigTfs: [['2h', '0 0 */2 * * *']],
        replicaDiscoveryKey: 'disc-key',
        collectSnapsItvMs: 1000,
        rotateLogsItvMs: 2000,
        refreshLogsCacheItvMs: 3000
      },
      globalConfig: { site: 'test' }
    },
    status: {},
    saveStatus () {},
    net_r0: {
      startRpcServer: async () => {},
      rpcServer: {
        respond (name, handler) {
          rpcHandlers[name] = handler
        },
        publicKey: Buffer.alloc(32, 1)
      },
      handleReply: async (method, req) => ({ method, req }),
      parseInputJSON: (req) => req,
      toOutJSON: (res) => res,
      dht: { defaultKeyPair: { publicKey: Buffer.alloc(32, 2) } }
    },
    store_s1: {
      getBee: async () => db,
      store: { primaryKey: Buffer.alloc(32, 3) }
    },
    interval_0: {
      add (name, fn, ms) {
        intervalAdds.push({ name, ms })
      }
    },
    scheduler_0: {
      add (name, fn, cron) {
        schedulerAdds.push({ name, cron })
      }
    },
    miningosThgWriteCalls_0: {
      bindWriteCalls () {},
      whitelistActions () {}
    },
    setupThings: async () => 1,
    ...extra
  })
  return { w, db, intervalAdds, schedulerAdds, rpcHandlers }
}

async function runStart (w, { onStartReplica } = {}) {
  const origParentStart = TetherWrkBase.prototype._start
  const origStartReplica = lWrkFunReplica.startReplica
  TetherWrkBase.prototype._start = function (cb) {
    cb()
  }
  lWrkFunReplica.startReplica = function () {
    if (onStartReplica) onStartReplica()
  }
  try {
    await new Promise((resolve, reject) => {
      w._start(err => (err ? reject(err) : resolve()))
    })
  } finally {
    TetherWrkBase.prototype._start = origParentStart
    lWrkFunReplica.startReplica = origStartReplica
  }
}

test('WrkProcVar: _start master wires rpc db intervals and replica', async t => {
  const replicaStarted = []
  const { w, intervalAdds, schedulerAdds, rpcHandlers } = buildStartWorker()

  await runStart(w, {
    onStartReplica: () => replicaStarted.push(1)
  })

  t.ok(rpcHandlers.echo)
  t.ok(rpcHandlers.registerThing)
  t.is(RPC_METHODS.every(m => rpcHandlers[m]), true)
  t.ok(w.db)
  t.ok(w.things)
  t.ok(w.meta_logs)
  t.ok(w.settings)
  t.is(w.status.rpcPublicKey, w.getRpcKey().toString('hex'))
  t.ok(intervalAdds.some(a => a.name === 'collectSnaps'))
  t.ok(intervalAdds.some(a => a.name === 'rotateLogs'))
  t.ok(intervalAdds.some(a => a.name === 'refreshLogsCache'))
  t.absent(intervalAdds.find(a => a.name === 'setupThings'))
  t.ok(schedulerAdds.length >= 1)
  t.is(replicaStarted.length, 1)
})

test('WrkProcVar: _start slave uses replica db and slave intervals', async t => {
  const repKey = 'cc'.repeat(32)
  const { w, intervalAdds } = buildStartWorker({
    ctx: { rack: 'test-rack', slave: true, root: process.cwd() },
    status: {
      replica_conf: {
        metaDiscoveryKeys: { 'main-0': repKey }
      }
    },
    conf: {
      thing: {
        refreshThingsItvMs: 60000,
        refreshReplicaConfItvMs: 30000,
        refreshLogsCacheItvMs: 45000
      }
    },
    store_s1: {
      getBee: async (opts) => {
        t.is(opts.key.toString('hex'), repKey)
        return createMockDb()
      },
      store: { primaryKey: Buffer.alloc(32, 3) }
    }
  })

  await runStart(w)

  t.ok(intervalAdds.some(a => a.name === 'setupThings'))
  t.ok(intervalAdds.some(a => a.name === 'refreshReplicaConf'))
  t.absent(intervalAdds.find(a => a.name === 'collectSnaps'))
  t.absent(intervalAdds.find(a => a.name === 'refreshLogsCache'))
})

test('WrkProcVar: _start slave refreshes replica conf when missing', async t => {
  const { w } = buildStartWorker({
    ctx: { rack: 'test-rack', slave: true, root: process.cwd() },
    status: {},
    conf: { thing: {} }
  })
  const origRefresh = lWrkFunReplica.refreshReplicaConf
  lWrkFunReplica.refreshReplicaConf = async function () {
    this.mem.replica_conf = { metaDiscoveryKeys: { 'main-0': 'dd'.repeat(32) } }
  }

  try {
    await runStart(w)
    t.ok(w.mem.replica_conf)
  } finally {
    lWrkFunReplica.refreshReplicaConf = origRefresh
  }
})

test('WrkProcVar: _start slave throws when replica conf unavailable', async t => {
  const { w } = buildStartWorker({
    ctx: { rack: 'test-rack', slave: true, root: process.cwd() },
    status: {},
    conf: { thing: {} }
  })
  const origRefresh = lWrkFunReplica.refreshReplicaConf
  lWrkFunReplica.refreshReplicaConf = async () => {}

  try {
    await t.exception(async () => runStart(w), /ERR_REPLICA_FAILED/)
  } finally {
    lWrkFunReplica.refreshReplicaConf = origRefresh
  }
})

test('WrkProcVar: _start audit rpc handler delegates to handleRpcReply', async t => {
  const { w, rpcHandlers } = buildStartWorker()
  let audited = false
  w.handleRpcReply = async (method, req) => {
    audited = true
    t.is(method, 'registerThing')
    return 1
  }

  await runStart(w)
  await rpcHandlers.registerThing({ id: 't1', opts: { host: 'h' } })
  t.ok(audited)
})
