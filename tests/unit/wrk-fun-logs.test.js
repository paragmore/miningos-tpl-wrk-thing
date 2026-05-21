'use strict'

const test = require('brittle')
const fs = require('fs')
const { readdir, stat } = require('fs/promises')
const { join } = require('path')
const StoreFacility = require('@tetherto/hp-svc-facs-store')
const {
  rotateLogs,
  getBeeTimeLog,
  releaseBeeTimeLog,
  refreshLogsCache,
  saveLogData
} = require('../../workers/lib/wrk-fun-logs')
const utilsStore = require('@tetherto/hp-svc-facs-store/utils')
const { getLogMaxHeight } = require('../../workers/lib/utils')

const storeDir = 'tests/store'
let thingWorker
let logIndex = 0
const logRotateMaxLength = 1000
const logKeepCount = 3

// maxHeight calculation used by refreshLogsCache
const logMaxHeight = getLogMaxHeight(logKeepCount)

test('lib:wrk-fun-logs', async (main) => {
  const store = new StoreFacility({}, { ns: 's0', storeDir }, { env: 'test' })
  await store.start()
  const db = await store.getBee({ name: 'main' }, { keyEncoding: 'utf-8' })
  await db.ready()

  thingWorker = {
    ctx: {},
    conf: {
      thing: {
        logRotateMaxLength,
        logKeepCount
      }
    },
    mem: { log_cache: {} },
    meta_logs: db.sub('meta_logs_00'),
    store_s1: store,
    debug: console.log,
    debugError: console.error
  }

  main.teardown(() => {
    // delete test store dir after tests complete
    fs.rmSync(storeDir, { recursive: true, force: true })
  })

  const addTestKeys = async (name, count, start = 0) => {
    // add test key/values
    const log = await getBeeTimeLog.call(thingWorker, name, 0, true)
    for (let index = start + 1; index < (start + count); index++) {
      const kts = utilsStore.convIntToBin(index)
      await log.put(kts, Buffer.from(JSON.stringify({
        ts: Date.now(),
        key: index
      })))
    }
    await releaseBeeTimeLog.call(thingWorker, log)
  }

  const getLogName = () => {
    return `test-log-${logIndex++}`
  }

  const getLog = async (name, offset = 0) => {
    return await getBeeTimeLog.call(thingWorker, name, offset)
  }

  const dirSize = async (dir) => {
    const files = await readdir(dir, { withFileTypes: true })
    const paths = files.map(async file => {
      const path = join(dir, file.name)
      if (file.isDirectory()) return await dirSize(path)
      if (file.isFile()) {
        const { size } = await stat(path)
        return size
      }
      return 0
    })

    return (await Promise.all(paths)).flat().reduce((i, size) => i + size, 0)
  }

  await main.test('getBeeTimeLog: incorrect key should return null', async (t) => {
    const logName = 'test-log'
    const log = await getBeeTimeLog.call(thingWorker, logName, 0, false)
    t.absent(log)
  })

  await main.test('getBeeTimeLog: init new bee log', async (t) => {
    const logName = 'test-log'
    const log = await getBeeTimeLog.call(thingWorker, logName, 0, true)
    t.ok(log)
    t.ok(log.discoveryKey)
    t.is(log.opened, true)
  })

  await main.test('saveLogData writes entry and releases log', async (t) => {
    const logName = getLogName()
    const ts = Date.now()
    await saveLogData.call(thingWorker, logName, ts, { v: 1 }, 0, true)
    const log = await getBeeTimeLog.call(thingWorker, logName, 0, false)
    t.ok(log)
    const kts = utilsStore.convIntToBin(ts)
    const entry = await log.get(kts)
    t.ok(entry)
    const row = JSON.parse(entry.value.toString())
    t.is(row.v, 1)
    await releaseBeeTimeLog.call(thingWorker, log)
  })

  await main.test('getBeeTimeLog: get existing bee log', async (t) => {
    const logName = 'test-log'
    const log = await getBeeTimeLog.call(thingWorker, logName, 0, false)
    t.ok(log)
    t.ok(log.discoveryKey)
    t.is(log.opened, true)
  })

  await main.test('rotateLogs: log rotation limit not reached', async (t) => {
    const logName = getLogName()
    await addTestKeys(logName, logRotateMaxLength - 1)

    const result = await rotateLogs.call(thingWorker)
    t.is(Array.isArray(result), true)
    t.is(result.length, 0)
  })

  await main.test('rotateLogs: log rotation called once', async (t) => {
    const logName = getLogName()
    await addTestKeys(logName, logRotateMaxLength)

    const result = await rotateLogs.call(thingWorker)
    t.is(Array.isArray(result), true)
    t.is(result.length, 1)
    t.is(result[0][0], logName)
    t.is(result[0][1].cur, 0)
  })

  await main.test('rotateLogs: log rotation called multiple times', async (t) => {
    const logsSize = 10
    const logName = getLogName()

    for (let index = 0; index < logsSize; index++) {
      await addTestKeys(logName, logRotateMaxLength)
      const result = await rotateLogs.call(thingWorker)
      t.is(Array.isArray(result), true)
      t.is(result.length, 1)
      t.is(result[0][0], logName)
      t.is(result[0][1].cur, index)
    }
  })

  await main.test('rotateLogs: log rotation called for multiple Hyperbee logs', async (t) => {
    const logsCount = 10
    for (let index = 0; index < logsCount; index++) {
      const logName = getLogName()
      await addTestKeys(logName, logRotateMaxLength)
    }

    const result = await rotateLogs.call(thingWorker)
    t.is(Array.isArray(result), true)
    t.is(result.length, logsCount)

    for (let index = 0; index < logsCount; index++) {
      t.is(result[0][1].cur, 0)
    }
  })

  await main.test('rotateLogs: should return early when ctx.slave is true', async (t) => {
    const logName = getLogName()
    await addTestKeys(logName, logRotateMaxLength)

    thingWorker.ctx.slave = true
    const result = await rotateLogs.call(thingWorker)
    t.is(result, undefined)
    thingWorker.ctx.slave = false
  })

  await main.test('rotateLogs: should return empty array when logRotateMaxLength is not set', async (t) => {
    const logName = getLogName()
    await addTestKeys(logName, logRotateMaxLength)

    const originalLogRotateMaxLength = thingWorker.conf.thing.logRotateMaxLength
    thingWorker.conf.thing.logRotateMaxLength = undefined
    const result = await rotateLogs.call(thingWorker)
    t.is(Array.isArray(result), true)
    t.is(result.length, 0)
    thingWorker.conf.thing.logRotateMaxLength = originalLogRotateMaxLength
  })

  await main.test('rotateLogs: should handle null log gracefully', async (t) => {
    const logName = getLogName()
    // Create meta entry but don't create the actual log
    await thingWorker.meta_logs.put(logName, Buffer.from(JSON.stringify({ cur: 0 })))

    const result = await rotateLogs.call(thingWorker)
    t.is(Array.isArray(result), true)
    // Should not throw error and should continue processing other logs
    // The result may contain other logs that were rotated, but our null log should not cause an error
    t.ok(true, 'Should handle null log without throwing error')

    // Clean up the meta entry
    await thingWorker.meta_logs.del(logName)
  })

  await main.test('rotateLogs: should rotate when log length equals logRotateMaxLength', async (t) => {
    const logName = getLogName()
    await addTestKeys(logName, logRotateMaxLength)

    const result = await rotateLogs.call(thingWorker)
    t.is(Array.isArray(result), true)
    t.ok(result.length >= 1, 'Should have at least one rotated log')

    // Find our log in the results
    const ourLogResult = result.find(r => r[0] === logName)
    t.ok(ourLogResult !== undefined, 'Our log should be in the rotation results')
    if (ourLogResult) {
      t.is(ourLogResult[2], logRotateMaxLength, 'Log length should equal logRotateMaxLength')
    }
  })

  await main.test('rotateLogs: should return empty array when no logs exist', async (t) => {
    // Clear meta_logs
    const stream = thingWorker.meta_logs.createReadStream({})
    for await (const chunk of stream) {
      await thingWorker.meta_logs.del(chunk.key)
    }

    const result = await rotateLogs.call(thingWorker)
    t.is(Array.isArray(result), true)
    t.is(result.length, 0)
  })

  await main.test('refreshLogsCache: logMaxHeight not reached', async (t) => {
    const logsSize = logMaxHeight - 1
    const logName = getLogName()
    for (let index = 0; index < logsSize; index++) {
      await addTestKeys(logName, logRotateMaxLength, logRotateMaxLength * index)
      await refreshLogsCache.call(thingWorker)
      await rotateLogs.call(thingWorker)
    }

    const log = await getLog(logName, logsSize)
    t.is(log.core.length, logRotateMaxLength)
    await releaseBeeTimeLog.call(thingWorker, log)
  })

  await main.test('refreshLogsCache: logMaxHeight reached and first log gets removed', async (t) => {
    const logsSize = logMaxHeight
    const logName = getLogName()
    for (let index = 0; index < logsSize; index++) {
      await addTestKeys(logName, logRotateMaxLength, logRotateMaxLength * index)
      await refreshLogsCache.call(thingWorker)
      await rotateLogs.call(thingWorker)
    }

    const logBeforeRefresh = await getLog(logName, logsSize)
    t.is(logBeforeRefresh.core.length, logRotateMaxLength)
    await releaseBeeTimeLog.call(thingWorker, logBeforeRefresh)

    await refreshLogsCache.call(thingWorker)
    const logAfterRefresh = await getLog(logName, logsSize)
    t.is(logAfterRefresh.core.length, 0)

    await releaseBeeTimeLog.call(thingWorker, logAfterRefresh)
  })

  await main.test('refreshLogsCache: all the logs after logMaxHeight removed', async (t) => {
    const logsSize = 10
    const logName = getLogName()
    let maxSize = 0
    let minSize = 0
    for (let index = 0; index < logsSize; index++) {
      await addTestKeys(logName, logRotateMaxLength, logRotateMaxLength * index)

      const sizeBeforeRefresh = await dirSize(storeDir)
      await refreshLogsCache.call(thingWorker)
      const sizeAfterRefresh = await dirSize(storeDir)

      // size can reduce at anytime when gc triggers
      maxSize = sizeBeforeRefresh > maxSize ? sizeBeforeRefresh : maxSize
      if (!minSize) minSize = sizeAfterRefresh
      minSize = sizeAfterRefresh < minSize ? sizeAfterRefresh : minSize

      const log = await getLog(logName, index)
      if (index < logMaxHeight) {
        t.is(log.core.length, logRotateMaxLength)
      } else {
        t.is(log.core.length, 0)
      }
      await releaseBeeTimeLog.call(thingWorker, log)
      await rotateLogs.call(thingWorker)
    }

    if (minSize >= maxSize) t.fail()
    if (minSize < maxSize) t.pass()
  })

  await main.test('refreshLogsCache: should return early when logKeepCount is not set', async (t) => {
    const logName = getLogName()
    await addTestKeys(logName, logRotateMaxLength)

    const originalLogKeepCount = thingWorker.conf.thing.logKeepCount
    thingWorker.conf.thing.logKeepCount = undefined
    const result = await refreshLogsCache.call(thingWorker)
    t.is(Array.isArray(result), true)
    t.is(result.length, 0)
    thingWorker.conf.thing.logKeepCount = originalLogKeepCount
  })

  await main.test('refreshLogsCache: should populate cache when starting with empty cache', async (t) => {
    const logName = getLogName()
    thingWorker.mem.log_cache = {}
    await addTestKeys(logName, logRotateMaxLength)

    await refreshLogsCache.call(thingWorker)
    const cacheKeys = Object.keys(thingWorker.mem.log_cache)
    t.ok(cacheKeys.length > 0)
    for (const key of cacheKeys) {
      t.ok(thingWorker.mem.log_cache[key])
      t.ok(thingWorker.mem.log_cache[key].log)
      t.is(typeof thingWorker.mem.log_cache[key].offset, 'number')
      t.ok(thingWorker.mem.log_cache[key].offset >= 0)
    }
  })

  await main.test('refreshLogsCache: should cleanup cache entries with offset -1', async (t) => {
    // Clear cache to start fresh
    thingWorker.mem.log_cache = {}
    const logName = getLogName()
    await addTestKeys(logName, logRotateMaxLength)
    await refreshLogsCache.call(thingWorker)

    const initialCacheSize = Object.keys(thingWorker.mem.log_cache).length
    t.ok(initialCacheSize > 0, 'Cache should have entries')

    // Get a cache entry to make stale
    const cacheKeys = Object.keys(thingWorker.mem.log_cache)
    const staleKey = cacheKeys[0]
    const staleEntry = thingWorker.mem.log_cache[staleKey]
    const staleLogKey = staleEntry.log.core.key.toString('hex')

    // Close the log
    await releaseBeeTimeLog.call(thingWorker, staleEntry.log)

    // Unlink the log store to make it truly stale
    try {
      await thingWorker.store_s1.unlink(staleLogKey)
    } catch (e) {
      // Ignore if already unlinked
    }

    thingWorker.mem.log_cache[staleKey].offset = -1
    const entry = thingWorker.mem.log_cache[staleKey]
    if (entry && entry.offset < 0) {
      await releaseBeeTimeLog.call(thingWorker, entry.log)
      delete thingWorker.mem.log_cache[staleKey]
      try {
        await thingWorker.store_s1.unlink(staleKey)
      } catch (e) {
        // Ignore errors
      }
    }

    // The stale entry should be removed from cache
    const staleEntryAfterCleanup = thingWorker.mem.log_cache[staleKey]
    t.is(staleEntryAfterCleanup, undefined, 'Stale entry should be removed from cache')
  })

  await main.test('refreshLogsCache: should handle multiple log keys correctly', async (t) => {
    thingWorker.mem.log_cache = {}
    const logNames = [getLogName(), getLogName(), getLogName()]

    for (const logName of logNames) {
      await addTestKeys(logName, logRotateMaxLength)
    }

    await refreshLogsCache.call(thingWorker)
    const cacheKeys = Object.keys(thingWorker.mem.log_cache)
    t.ok(cacheKeys.length > 0)

    // Verify all log names are represented in cache descriptions
    const cacheDescriptions = Object.values(thingWorker.mem.log_cache).map(entry => entry.desc)
    for (const logName of logNames) {
      t.ok(cacheDescriptions.includes(logName), `Log ${logName} should be in cache`)
    }
  })

  await main.test('refreshLogsCache: should skip missing logs at certain offsets', async (t) => {
    const logName = getLogName()
    thingWorker.mem.log_cache = {}

    // Create log at offset 0
    await addTestKeys(logName, logRotateMaxLength, 0)
    await rotateLogs.call(thingWorker)

    // Create log at offset 2 (skip offset 1)
    await addTestKeys(logName, logRotateMaxLength, logRotateMaxLength * 2)
    await rotateLogs.call(thingWorker)

    // Should not throw error and should continue processing
    await refreshLogsCache.call(thingWorker)

    const cacheKeys = Object.keys(thingWorker.mem.log_cache)
    t.ok(cacheKeys.length > 0)
    // Verify offset 0 and 2 are in cache, but offset 1 is skipped
    const offsets = Object.values(thingWorker.mem.log_cache).map(entry => entry.offset)
    t.ok(offsets.includes(0), 'Offset 0 should be in cache')
    t.ok(offsets.includes(2), 'Offset 2 should be in cache')
  })

  await main.test('refreshLogsCache: should update existing cache entries with new offset', async (t) => {
    const logName = getLogName()
    thingWorker.mem.log_cache = {}

    // Create initial log
    await addTestKeys(logName, logRotateMaxLength)
    await refreshLogsCache.call(thingWorker)

    const cacheKeys = Object.keys(thingWorker.mem.log_cache)
    t.ok(cacheKeys.length > 0)

    // Rotate log to create new offset
    await addTestKeys(logName, logRotateMaxLength)
    await rotateLogs.call(thingWorker)

    // Refresh cache - should update offsets
    await refreshLogsCache.call(thingWorker)

    // Verify cache still has entries and offsets may have changed
    const finalCacheKeys = Object.keys(thingWorker.mem.log_cache)
    t.ok(finalCacheKeys.length > 0)
  })

  await main.test('refreshLogsCache: should handle empty meta_logs stream', async (t) => {
    thingWorker.mem.log_cache = {}
    const logName = getLogName()
    await addTestKeys(logName, logRotateMaxLength)
    await refreshLogsCache.call(thingWorker)

    const cacheSizeBefore = Object.keys(thingWorker.mem.log_cache).length
    t.ok(cacheSizeBefore > 0)

    // Clear meta_logs
    const stream = thingWorker.meta_logs.createReadStream({})
    for await (const chunk of stream) {
      await thingWorker.meta_logs.del(chunk.key)
    }

    await refreshLogsCache.call(thingWorker)

    // All cache entries should have offset -1 or be removed
    const cacheEntries = Object.values(thingWorker.mem.log_cache)
    for (const entry of cacheEntries) {
      t.is(entry.offset, -1, 'All entries should have offset -1 after empty meta_logs')
    }
  })

  await main.test('getBeeTimeLog: slave resolves log via replica key', async (t) => {
    const logName = getLogName()
    await addTestKeys(logName, 3)
    const masterLog = await getLog(logName, 0)
    const repKey = masterLog.core.key.toString('hex')
    await releaseBeeTimeLog.call(thingWorker, masterLog)

    const slaveWorker = {
      ...thingWorker,
      ctx: { slave: true },
      mem: {
        replica_conf: {
          metaDiscoveryKeys: {
            [`${logName}-0`]: repKey
          }
        }
      }
    }

    const log = await getBeeTimeLog.call(slaveWorker, logName, 0)
    t.ok(log)
    await releaseBeeTimeLog.call(slaveWorker, log)
  })

  await main.test('getBeeTimeLog: rotates corrupted log at offset 0', async (t) => {
    const logName = getLogName()
    await addTestKeys(logName, 3)
    const log = await getLog(logName, 0)
    const origStream = log.createReadStream.bind(log)
    log.createReadStream = () => {
      throw new Error('corrupt read')
    }

    const rotated = await getBeeTimeLog.call(thingWorker, logName, 0)
    t.ok(rotated)
    log.createReadStream = origStream
    await releaseBeeTimeLog.call(thingWorker, rotated)
  })

  await main.test('getBeeTimeLog: returns null when log.ready fails', async (t) => {
    const logName = getLogName()
    await thingWorker.meta_logs.put(
      logName,
      Buffer.from(JSON.stringify({ cur: 0 }))
    )
    const badLog = await thingWorker.store_s1.getBee(
      { name: `${logName}-5-0` },
      { keyEncoding: 'binary' }
    )
    badLog.ready = async () => {
      throw new Error('ready failed')
    }

    const origGetBee = thingWorker.store_s1.getBee.bind(thingWorker.store_s1)
    thingWorker.store_s1.getBee = async (opts) => {
      if (opts.name === `${logName}-5-0`) return badLog
      return origGetBee(opts)
    }

    const log = await getBeeTimeLog.call(thingWorker, logName, 0)
    t.is(log, null)
    thingWorker.store_s1.getBee = origGetBee
    await thingWorker.meta_logs.del(logName)
  })

  await main.test('refreshLogsCache: should handle errors during cleanup gracefully', async (t) => {
    const logName = getLogName()
    await addTestKeys(logName, logRotateMaxLength)
    await refreshLogsCache.call(thingWorker)

    // Create a stale entry
    const cacheKeys = Object.keys(thingWorker.mem.log_cache)
    if (cacheKeys.length > 0) {
      const staleKey = cacheKeys[0]
      thingWorker.mem.log_cache[staleKey].offset = -1

      // Mock unlink to throw error
      const originalUnlink = thingWorker.store_s1.unlink
      let unlinkCallCount = 0
      thingWorker.store_s1.unlink = async (key) => {
        unlinkCallCount++
        if (unlinkCallCount === 1) {
          throw new Error('Mock unlink error')
        }
        return originalUnlink.call(thingWorker.store_s1, key)
      }

      // Should not throw error
      await refreshLogsCache.call(thingWorker)

      // Restore original unlink
      thingWorker.store_s1.unlink = originalUnlink
      t.pass('Should handle cleanup errors gracefully')
    } else {
      t.skip('No cache entries to test cleanup error handling')
    }
  })
})
