'use strict'

const test = require('brittle')
const fs = require('fs')
const worker = require('@bitfinex/bfx-svc-boot-js/lib/worker')
const RPC = require('@hyperswarm/rpc')
const { setTimeout: sleep } = require('timers/promises')
const { getBeeTimeLog, releaseBeeTimeLog } = require('../../workers/lib/wrk-fun-logs')
const { getRandomIP, getRandomString } = require('../utils')

const storeDir = 'store'
const statusDir = 'status'
const rack = 'rack-1'
let rpc
let rpcClient
let thingWorker
const thingId = 'testminer-1'

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

    fs.writeFileSync('./config/common.json', JSON.stringify(commonConf))
    fs.writeFileSync('./config/base.thing.json', '{}')
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

  const setThingSnap = () => {
    thingWorker.mem.things['testminer-1'].last = {
      ts: 1725288102980,
      err: null,
      snap: {
        success: true,
        raw_errors: [],
        stats: {
          status: 'mining',
          power_w: 5848,
          efficiency_w_ths: 27.09,
          pool_status: [],
          uptime_ms: 130394000,
          hashrate_mhs: {
            avg: 204524413,
            t_5s: 266461164.3,
            t_1m: 218380278.7,
            t_5m: 215875549.41,
            t_15m: 215965179.07
          },
          frequency_mhz: {
            avg: 577,
            target: 491,
            chips: []
          },
          temperature_c: {
            ambient: 51,
            max: 79.26,
            avg: 73.61,
            chips: [],
            pcb: []
          },
          miner_specific: {}
        }
      },
      alerts: []
    }
  }

  createConfig()

  startWorker()
  // wait for worker to start
  await sleep(5000)

  startRpcClient()
  await registerThing()
  setThingSnap()

  await main.test('stats save', async (t) => {
    const now = Date.now()
    const key = 'stat-5m'
    const tag = 'testminer'
    await thingWorker.buildStats('stat-5m', new Date(now - 10 * 60 * 1000))
    let tailLogs = await thingWorker.tailLog({ key, tag })
    t.is(tailLogs.length, 1)

    const logName = `${key}-${tag}`
    const log = await getBeeTimeLog.call(thingWorker, logName, 0, false)

    await thingWorker.buildStats('stat-5m', new Date(now - 5 * 60 * 1000))
    tailLogs = await thingWorker.tailLog({ key, tag })
    t.is(tailLogs.length, 2)

    await releaseBeeTimeLog.call(thingWorker, log)

    await thingWorker.buildStats('stat-5m', new Date())
    tailLogs = await thingWorker.tailLog({ key, tag })
    t.is(tailLogs.length, 3)
  })
})
