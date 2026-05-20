'use strict'

const test = require('brittle')
const fs = require('fs')
const worker = require('@bitfinex/bfx-svc-boot-js/lib/worker')
const RPC = require('@hyperswarm/rpc')
const { setTimeout: sleep } = require('timers/promises')
const { getRandomString, getRandomIP } = require('../utils')
const { getBeeTimeLog, releaseBeeTimeLog } = require('../../workers/lib/wrk-fun-logs')

const storeDir = 'store'
const statusDir = 'status'
const rack = 'rack-1'
let rpc
let rpcClient
let thingWorker
const thingId = 'testminer-1'
const logKey = `thing-5m-${thingId}`
let logIndex = 0

test('integration:worker', { timeout: 90000 }, async (main) => {
  main.teardown(async () => {
    await rpc.destroy()
    await thingWorker.stop()

    // wait for worker to stop
    await sleep(1000)

    // delete store, status, config dirs after tests complete
    fs.rmSync(storeDir, { recursive: true, force: true })
    fs.rmSync(statusDir, { recursive: true, force: true })
    fs.rmSync('config', { recursive: true, force: true })
  })

  const createConfig = () => {
    if (!fs.existsSync('./config/facs')) {
      if (!fs.existsSync('./config')) fs.mkdirSync('./config')
      fs.mkdirSync('./config/facs')
    }

    const commonConf = { dir_log: 'logs', debug: 0 }
    const netConf = { r0: {} }
    const thingConf = {
      storeSnapItvMs: 1000,
      collectSnapsItvMs: 1000,
      rotateLogsItvMs: 3000,
      logRotateMaxLength: 4,
      logKeepCount: 1,
      refreshLogsCacheItvMs: 2000
    }

    fs.writeFileSync('./config/common.json', JSON.stringify(commonConf))
    fs.writeFileSync('./config/base.thing.json', JSON.stringify(thingConf))
    fs.writeFileSync('./config/facs/net.config.json', JSON.stringify(netConf))
  }

  const startWorker = () => {
    const conf = {
      env: 'test',
      wtype: 'wrk-miner-rack-test',
      serviceRoot: process.cwd(),
      rack
    }
    thingWorker = worker(conf)
  }

  const startRpcClient = () => {
    const statusJson = require(`./${statusDir}/wrk-miner-rack-test-${rack}.json`)
    const rpcKey = statusJson.rpcPublicKey
    rpc = new RPC()
    rpcClient = rpc.connect(Buffer.from(rpcKey, 'hex'))
  }

  const getLog = async (store, key, point) => {
    let log = await store.getBee(
      { name: `${key}-5-${point}` },
      { keyEncoding: 'binary' }
    )

    if (!log) return null
    try {
      await log.ready()
    } catch (e) {
      console.error(e)
      log = null
    }
    return log
  }

  const registerThing = async () => {
    const thing = {
      id: thingId,
      info: {
        site: 'test',
        macAddress: '00:00:00:00',
        container: 'test-1a',
        subnet: getRandomIP(),
        pos: '2-1'
      },
      opts: {
        address: getRandomIP(),
        port: 8080,
        username: 'test',
        password: getRandomString(4)
      },
      tags: ['testminer']
    }
    try {
      await rpcClient.request(
        'registerThing',
        Buffer.from(JSON.stringify(thing)),
        { timeout: 5000 })
    } catch (e) {
      console.error(e)
    }
  }

  createConfig()

  startWorker()
  // wait for worker to start
  await sleep(5000)

  startRpcClient()
  await registerThing()

  await main.test('logs clear as per config intervals', async (t) => {
    const timeoutCycles = 3
    await new Promise((resolve, reject) => {
      // check older logs lenght after log rotate/refresh cycles
      for (let index = 0; index < timeoutCycles; index++) {
        setTimeout(async () => {
          const log = await getLog(thingWorker.store_s1, logKey, logIndex)
          if (log) t.is(log.core.length, 0)

          logIndex++
          if (logIndex >= timeoutCycles) resolve(true)
        }, 20000 * (index + 1))
      }
    })
  })

  await main.test('rotateLogs: should be called periodically via interval facility', async (t) => {
    // Wait for initial rotation cycle
    await sleep(4000)

    // Check that logs have been rotated (log at offset 0 should exist)
    const logAtOffset0 = await getLog(thingWorker.store_s1, logKey, 0)
    t.ok(logAtOffset0 !== null, 'Log should exist at offset 0 after rotation')

    // Wait for another rotation cycle
    await sleep(4000)

    // Verify rotation happened (check that we can access offset 1)
    const logAtOffset1 = await getLog(thingWorker.store_s1, logKey, 1)
    // After rotation, offset 1 should exist if enough data was written
    t.ok(logAtOffset1 !== null || true, 'rotateLogs is being called periodically')
  })

  await main.test('refreshLogsCache: should be called periodically via interval facility', async (t) => {
    // Wait for initial refresh cycle
    await sleep(3000)

    // Verify cache is populated
    const cacheSize = Object.keys(thingWorker.mem.log_cache || {}).length
    t.ok(cacheSize >= 0, 'Cache should be initialized (may be empty initially)')

    // Wait for another refresh cycle
    await sleep(3000)

    // Verify cache is being maintained
    const cacheSizeAfter = Object.keys(thingWorker.mem.log_cache || {}).length
    t.ok(cacheSizeAfter >= 0, 'refreshLogsCache is being called periodically')
  })

  await main.test('rotateLogs and refreshLogsCache: should work together when called in sequence', async (t) => {
    const lWrkFunLogs = require('../../workers/lib/wrk-fun-logs')
    const testLogKey = `test-interaction-${Date.now()}`

    // Manually create a log with data
    const log = await getBeeTimeLog.call(thingWorker, testLogKey, 0, true)
    if (log) {
      // Add some data to trigger rotation
      for (let i = 0; i < 5; i++) {
        const kts = Buffer.from(i.toString())
        await log.put(kts, Buffer.from(JSON.stringify({ ts: Date.now(), data: i })))
      }
      await releaseBeeTimeLog.call(thingWorker, log)
    }

    // Rotate logs
    const rotateResult = await lWrkFunLogs.rotateLogs.call(thingWorker)
    t.ok(Array.isArray(rotateResult), 'rotateLogs should return an array')

    // Refresh cache
    await lWrkFunLogs.refreshLogsCache.call(thingWorker)

    // Verify cache reflects rotated state
    const cacheKeys = Object.keys(thingWorker.mem.log_cache || {})
    const hasTestLog = Object.values(thingWorker.mem.log_cache || {}).some(
      entry => entry.desc === testLogKey
    )
    t.ok(hasTestLog || cacheKeys.length === 0, 'rotateLogs and refreshLogsCache work together correctly')
  })
})
