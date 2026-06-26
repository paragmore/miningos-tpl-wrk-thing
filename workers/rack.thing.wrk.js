'use strict'

const async = require('async')
const TetherWrkBase = require('@tetherto/tether-wrk-base/workers/base.wrk.tether')
const debug = require('debug')('thing:proc')
const { v4: uuidv4 } = require('uuid')
const utilsStore = require('@tetherto/hp-svc-facs-store/utils')
const mingo = require('mingo')
const gLibStats = require('@tetherto/miningos-lib-stats')
const gLibUtilBase = require('@bitfinex/lib-js-util-base')
const { promiseTimeout } = require('@bitfinex/lib-js-util-promise')
const lWrkFunStats = require('./lib/wrk-fun-stats')
const lWrkFunAlerts = require('./lib/wrk-fun-alerts')
const lWrkFunLogs = require('./lib/wrk-fun-logs')
const lWrkFunReplica = require('./lib/wrk-fun-replica')
const lWrkFunSettings = require('./lib/wrk-fun-settings')
const { exit } = require('node:process')
const { getLogsCountForTimeRange, getLogMaxHeight, getJsonChanges, aggregateLogs, getThingSorter } = require('./lib/utils')
const { STAT_RTD, OPTIONAL_CONFIGS, RPC_METHODS, AUDIT_METHODS, MAIN_DB } = require('./lib/constants')

class WrkProcVar extends TetherWrkBase {
  constructor (conf, ctx) {
    super(conf, ctx)

    if (!ctx.rack) {
      throw new Error('ERR_PROC_RACK_UNDEFINED')
    }

    this.prefix = `${this.wtype}-${ctx.rack}`

    this.loadConf('base.thing', 'thing')
    this._loadOptionalConfigs()

    this.init()
    this.start()

    this._handler = this._createApplyThingsProxy()
  }

  loadLib (type) {
    let lib = null

    try {
      lib = require(`${this.ctx.root}/workers/lib/${type}`)
    } catch (e) {
      debug('WARNING: LOCAL_LIB_NOTFOUND', type, e)
    }

    return lib
  }

  getThingType () {
    return 'thing'
  }

  getThingTags () {
    return []
  }

  selectThingInfo () {
    return {}
  }

  _getWrkExtData (args) {
    return {}
  }

  _loadOptionalConfigs () {
    OPTIONAL_CONFIGS.forEach(config => {
      try {
        this.loadConf(config.name, config.key)
      } catch (e) {
        this.debug(`skipping config ${config.name}`, e)
      }
    })
  }

  init () {
    super.init()

    const ctx = this.ctx

    this.rackId = `${this.getThingType()}-${ctx.rack}`

    this.setInitFacs([
      ['fac', '@bitfinex/bfx-facs-interval', '0', '0', {}, -10],
      ['fac', '@bitfinex/bfx-facs-scheduler', '0', '0', {}, -10],
      ['fac', '@tetherto/hp-svc-facs-store', 's1', 's1', {
        storePrimaryKey: this.ctx.storePrimaryKey,
        storeDir: `store/${this.ctx.rack}-db`
      }, -5],
      ['fac', '@tetherto/svc-facs-miningos-thg-write-calls', '0', '0', { maxParallelWriteValidations: 5 }, 20]
    ])

    this.mem = {
      things: {},
      log: {},
      log_cache: {},
      log_map: {},
      collectingThingSnap: {}
    }
  }

  debugThingError (thg, e) {
    debug(`[THING/${this.rackId}/${thg.id}]`, e)
  }

  debugError (data, e) {
    debug(`[THING/${this.rackId}]`, data, e)
  }

  debug (data) {
    debug(`[THING/${this.rackId}]`, data)
  }

  loggerMixin () {
    return { rackId: this.rackId }
  }

  _auditLog (action, req, opts = {}) {
    try {
      if (!this.logger) return

      const { outcome = 'success', error = null, detail = {} } = opts
      const level = outcome === 'success' ? 'info' : 'warn'
      this.logger[level]({
        audit: true,
        action,
        outcome,
        user: req.user || null,
        thingId: req.id || req.thingId || null,
        detail,
        ...(error ? { error } : {})
      }, `audit: ${action} ${outcome}`)
    } catch (e) {
      this.debugError('ERR_AUDIT_LOG', e)
    }
  }

  _getAuditDetail (method, req, result) {
    switch (method) {
      case 'registerThing':
        return { thingId: req.id, code: req.code }
      case 'updateThing':
        return { forceOverwrite: !!req.forceOverwrite, actionId: req.actionId }
      case 'saveThingComment':
        return { thingId: req.thingId }
      case 'editThingComment':
      case 'deleteThingComment':
        return { thingId: req.thingId, commentId: req.id || req.ts }
      case 'forgetThings':
        return { query: req.query, all: !!req.all }
      case 'applyThings':
        return { method: req.method, query: req.query, affected: result }
      case 'saveWrkSettings':
        return { entryKeys: req.entries ? Object.keys(req.entries) : [] }
      default:
        return {}
    }
  }

  async handleRpcReply (method, req) {
    let data
    try {
      data = this.net_r0.parseInputJSON(req)
    } catch (e) {
      this._auditLog(method, {}, { outcome: 'failure', error: e.message })
      return this.net_r0.toOutJSON(`[HRPC_ERR]=${e.message}`)
    }
    try {
      const res = await this[method](data)
      this._auditLog(method, data, { detail: this._getAuditDetail(method, data, res) })
      return this.net_r0.toOutJSON(res)
    } catch (e) {
      this._auditLog(method, data, { outcome: 'failure', error: e.message })
      return this.net_r0.toOutJSON(`[HRPC_ERR]=${e.message}`)
    }
  }

  _addWhitelistedActions (actions) {
    return this.miningosThgWriteCalls_0.whitelistActions(actions)
  }

  getRpcKey () {
    return this.net_r0.rpcServer.publicKey
  }

  async _getInfoHistoryLog () {
    return await lWrkFunLogs.getBeeTimeLog.call(
      this,
      'thing-history-log',
      0,
      true
    )
  }

  async _storeInfoChangesToDb (thgPrev, thg) {
    const log = await this._getInfoHistoryLog()
    try {
      const now = Date.now()
      const existingEntry = await log.get(utilsStore.convIntToBin(now))
      const existingInfoHistory =
        existingEntry?.value
          ? JSON.parse(existingEntry.value.toString())
          : []
      const updatedInfoHistory = [
        ...existingInfoHistory,
        {
          ts: now,
          changes: getJsonChanges(thgPrev.info, thg.info),
          id: thg.id
        }
      ]
      await log.put(
        utilsStore.convIntToBin(now),
        Buffer.from(
          JSON.stringify(updatedInfoHistory)
        )
      )
    } catch (e) {
      this.debugError('ERR_THING_SAVE_INFO_HISTORY', e)
    }
    await lWrkFunLogs.releaseBeeTimeLog.call(this, log)
  }

  async collectSnaps () {
    if (this.ctx.slave) {
      return
    }
    const thingConf = this.conf.thing
    const things = this.mem.things
    async.eachLimit(
      things,
      thingConf.thingQueryConcurrency,
      async (thg) => {
        await this._collectSnap(thg, thingConf)
      },
      async () => {
        await this.collectSnapsHook0()
      }
    )
    try {
      await this._saveAlerts()
    } catch (err) {
      this.debugError('ERR_SAVE_ALERTS', err)
    }
  }

  async _storeThingSnap ({ thg, thingLastCollectionTs, err, snap }) {
    try {
      const log = await lWrkFunLogs.getBeeTimeLog.call(this, `thing-5m-${thg.id}`, 0, true)
      const kts = utilsStore.convIntToBin(thingLastCollectionTs)

      await log.put(kts, Buffer.from(JSON.stringify({
        ts: thingLastCollectionTs,
        err: err ? err.message : null,
        snap
      })))

      await lWrkFunLogs.releaseBeeTimeLog.call(this, log)
    } catch (e) {
      this.debugError(snap, e)
    }
  }

  _getOfflineSnap () {
    return {
      success: false,
      stats: {
        status: 'offline'
      }
    }
  }

  async _collectSnap (thg, thingConf) {
    if (this.mem.collectingThingSnap[thg.id]?.isCollectingSnap) return
    this.mem.collectingThingSnap[thg.id] = {
      isCollectingSnap: true
    }
    const thingLastCollectionTs = Date.now()

    if (!this.mem.collectingThingSnap[thg.id].tsThingCollectSnap) {
      this.mem.collectingThingSnap[thg.id].tsThingCollectSnap = 0
    }

    const shouldStore =
      thingLastCollectionTs -
        this.mem.collectingThingSnap[thg.id].tsThingCollectSnap >
      thingConf.storeSnapItvMs
    async.retry(thingConf.collectSnapRetry || 3, async () => {
      let snap = null
      let err = null

      if (!thg.ctrl) {
        try {
          await this.connectThing(thg)
        } catch (e) {
          this.debugError('ERR_CONNECT_THING', e)
        }
      }

      // The device should be offline if marked as maintenance
      if (thg.info?.container === 'maintenance') {
        snap = this._getOfflineSnap()
      } else if (thg.ctrl) {
        try {
          snap = await promiseTimeout(
            this.collectThingSnap(thg),
            thingConf.collectSnapTimeoutMs
          )
        } catch (e) {
          if (e.message === 'ERR_PROMISE_TIMEOUT') {
            snap = this._getOfflineSnap()
          } else {
            err = e
            this.debugThingError(thg, e)
          }
        }
      } else {
        err = new Error('ERR_THING_CONNECTION_FAILURE')
      }

      thg.last.snap = snap

      if (thg.last?.snap) {
        thg.last.alerts = lWrkFunAlerts.processThingAlerts.call(this, thg)
      }

      thg.last.err = err ? err.message : null
      thg.last.ts = thingLastCollectionTs

      if (shouldStore) {
        await this._storeThingSnap({ err, snap, thg, thingLastCollectionTs })
      }
    }, async () => {
      this.mem.collectingThingSnap[thg.id] = {
        isCollectingSnap: false,
        thingLastCollectionTs,
        ...(shouldStore ? { tsThingCollectSnap: thingLastCollectionTs } : {})
      }
    })
  }

  async collectThingSnap (thg) {
    throw new Error('ERR_IMPL_UNKNOWN')
  }

  async connectThing (thg) {
    // no-op
  }

  async disconnectThing (thg) {
    if (typeof thg.ctrl?.close === 'function') {
      thg.ctrl.close()
    }
  }

  async releaseIpThing (thg) {
    // no-op
  }

  async registerThingHook0 (thg) {
    // no-op
  }

  async updateThingHook0 (thg, thgPrev) {
    if (!thg || !thgPrev) return
    try {
      await this._storeInfoChangesToDb(thgPrev, thg)
    } catch (error) {
      this.debugError('ERR_UPDATE_THING_STORE_INFO_CHANGES_TO_DB_FAILED')
    }
  }

  async forgetThingHook0 (thg) {
    // no-op
  }

  async setupThingHook0 (thg) {
    // no-op
  }

  async setupThingHook1 (thg) {
    // no-op
  }

  async tailLogHook0 (logs, req) {
    // no-op
  }

  async collectSnapsHook0 () {
    // no-op
  }

  async setupThing (base) {
    const thgId = base.id

    if (this.mem.things[thgId]) {
      return 0
    }

    const thg = {
      id: thgId,
      type: this.getThingType(),
      code: base.code,
      tags: base.tags,
      opts: base.opts,
      info: base.info,
      comments: base.comments,
      last: {},
      ctrl: null
    }

    if (!this.ctx.slave) {
      await this.setupThingHook0(thg)

      if (!thg.ctrl) {
        await this.connectThing(thg)
      }

      const log = await lWrkFunLogs.getBeeTimeLog.call(this, `thing-5m-${thgId}`, 0, true)

      try {
        let last = await log.peek({ reverse: true, limit: 1 })
        if (last) {
          last = JSON.parse(last.value.toString())
          thg.last = last
          await this.setupThingHook1(thg)
        }
      } catch (e) {
        this.debugError(null, e)
      }

      lWrkFunLogs.releaseBeeTimeLog.call(this, log)
    }

    this.mem.things[thgId] = thg

    return 1
  }

  async setupThings () {
    const valid = {}

    const streamThings = this.things.createReadStream()

    for await (const data of streamThings) {
      const entry = JSON.parse(data.value.toString())
      try {
        valid[entry.id] = true
        await this.setupThing(entry)
      } catch (e) {
        this.debugError(entry, e)
      }
    }

    const thgIds = Object.keys(this.mem.things)

    for await (const thgId of thgIds) {
      if (valid[thgId]) {
        continue
      }

      await this._forgetThing(thgId)
    }

    try {
      await this._assignCodesToThings()
    } catch (e) {
      this.debugError('ERR_ASSIGN_CODES_THINGS', e)
    }

    this.debug('things setup finished')

    return 1
  }

  _prepThingTags (thg, aux, thgPrev) {
    const parts = this.getThingType().split('-')
    parts.push('_') // placeholder for splice

    let tags = []

    for (let i = 1; i < parts.length; i++) {
      tags.push(`t-${parts.slice(0, -i).join('-')}`)
    }

    tags = tags.concat(this.getThingTags())

    if (aux) {
      if (!Array.isArray(aux)) {
        throw new Error('ERR_THING_TAGS_INVALID')
      }

      tags = tags.concat(aux)
    }

    if (Array.isArray(thgPrev?.tags)) {
      // retain previous tags
      tags = tags.concat(thgPrev.tags)
    }

    tags.push(`id-${thg.id}`)
    tags.push(`code-${thg.code}`)

    // remove pos and container tags before re-creating
    tags = tags.filter(val => !val.includes('pos-') && !val.includes('container-'))
    if (thg.info?.pos) tags.push(`pos-${thg.info.pos}`)
    if (thg.info?.container) tags.push(`container-${thg.info.container}`)

    return gLibUtilBase.getArrayUniq(tags)
  }

  _validateRegisterThing (data) {
    if (data.id && this.mem.things[data.id]) {
      throw new Error('ERR_THING_WITH_ID_ALREADY_EXISTS')
    }
    if (data.code && !(/-\d+$/.test(data.code))) {
      throw new Error('ERR_THING_CODE_INVALID')
    }
    if (data.code && Object.values(this.mem.things).some(thg => thg.code === data.code)) {
      throw new Error('ERR_THING_WITH_CODE_ALREADY_EXISTS')
    }
  }

  _validateUpdateThing (data) {
    // no op
  }

  _generateThingId () {
    return uuidv4()
  }

  _getMaxThingCode () {
    const things = Object.values(this.mem.things).filter(thg => thg.code)
    return things.reduce((acc, cur) => {
      const code = parseInt(cur.code.split('-').pop(), 10) || 0
      return Math.max(acc, code)
    }, 0)
  }

  _generateThingCode (_, seed) {
    const prefix = this.getThingType().replace(/^[^-]+-/, '').toUpperCase()
    const last = this._getMaxThingCode()
    const nextCode = (seed ?? (last + 1)).toString().padStart(4, '0')
    return `${prefix}-${nextCode}`
  }

  async _assignCodesToThings () {
    const things = Object.values(this.mem.things).filter(thg => !thg.code)
    if (things.length === 0) {
      this.mem.nextAvailableCode = this._generateThingCode()
      return
    }

    const last = this._getMaxThingCode()

    for (let i = 0; i < things.length; i++) {
      const thg = things[i]
      thg.code = this._generateThingCode(thg, last + i + 1)
      thg.tags.push(`code-${thg.code}`)
      await this._saveThingDataToDb(thg)
      this._saveThingDataToMem(thg)
      this.mem.nextAvailableCode = this._generateThingCode(thg, last + i + 2)
    }
  }

  _registerAndStoreThing = async (data) => {
    data.id = data.id ?? this._generateThingId()
    const thgId = data.id
    const code = data.code ?? this._generateThingCode(data)
    const tags = this._prepThingTags({ ...data, code }, data.tags)

    const thg = {
      id: thgId,
      opts: data.opts,
      info: data.info,
      code,
      tags,
      comments: data.comments
    }

    await this.registerThingHook0(thg)

    await this._storeThingDb(thg)

    this.mem.nextAvailableCode = this._generateThingCode(thg)

    return thg
  }

  /**
   * Creates a new thing (device) in the system.
   * @method registerThing
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {string} [req.id] - Device ID (auto-generated UUID if not provided)
   * @param {string} [req.code] - Device code (auto-generated if not provided, format: TYPE-NNNN)
   * @param {Object} req.opts - Device connection options (required)
   * @param {Object} [req.info] - Device metadata
   * @param {string[]} [req.tags] - Additional tags for categorization
   * @param {string} [req.comment] - Registration comment
   * @param {string} [req.user] - User making the request (required if comment provided)
   * @returns {Promise<number>} Returns 1 on success
   * @throws {Error} ERR_SLAVE_BLOCK - Operation blocked on slave/replica nodes
   * @throws {Error} ERR_THING_WITH_ID_ALREADY_EXISTS - Thing with this ID already exists
   * @throws {Error} ERR_THING_WITH_CODE_ALREADY_EXISTS - Thing with this code already exists
   * @throws {Error} ERR_THING_CODE_INVALID - Code format invalid (must end with -NNNN)
   */
  async registerThing (req) {
    if (this.ctx.slave) {
      throw new Error('ERR_SLAVE_BLOCK')
    }

    this._validateRegisterThing(req)

    let info = {}
    if (req.info) {
      info = req.info
    }
    const comments = []

    const user = req.user
    const comment = req.comment
    if (comment && user) {
      comments.push({
        ts: Date.now(),
        comment,
        user
      })
    }

    const createdAt = Date.now()
    info = { ...info, createdAt, updatedAt: createdAt }
    const thg = await this._registerAndStoreThing({
      id: req.id,
      opts: req.opts,
      info,
      tags: req.tags,
      code: req.code,
      comments
    })
    await this.setupThing(thg)

    return 1
  }

  _validateThingExists (id) {
    if (!id || !this.mem.things[id]) {
      throw new Error('ERR_THING_NOTFOUND')
    }
  }

  /**
   * Updates an existing thing's properties.
   * @method updateThing
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {string} req.id - Device ID (required)
   * @param {Object} [req.opts] - Updated connection options (merged with existing unless forceOverwrite)
   * @param {Object} [req.info] - Updated metadata (merged with existing unless forceOverwrite)
   * @param {string[]} [req.tags] - Updated tags
   * @param {boolean} [req.forceOverwrite=false] - If true, replace opts/info instead of merging
   * @param {string} [req.comment] - Update comment
   * @param {string} [req.user] - User making the request (required if comment provided)
   * @param {string} [req.actionId] - Action identifier for tracking
   * @returns {Promise<number>} Returns 1 on success
   * @throws {Error} ERR_SLAVE_BLOCK - Operation blocked on slave/replica nodes
   * @throws {Error} ERR_THING_NOTFOUND - Thing with specified ID not found
   */
  async updateThing (req) {
    if (this.ctx.slave) {
      throw new Error('ERR_SLAVE_BLOCK')
    }

    this._validateThingExists(req.id)
    this._validateUpdateThing(req)

    let thg = await this.things.get(req.id)
    thg = JSON.parse(thg.value.toString())
    const thgPrev = { opts: { ...thg.opts }, info: { ...thg.info }, tags: [...thg.tags] }

    if (!thg.code) {
      thg.code = this._generateThingCode(thg)
    }

    if (req.opts) {
      thg.opts = req.forceOverwrite ? req.opts : { ...thg.opts, ...req.opts }
    }

    if (!Array.isArray(thg.comments)) {
      thg.comments = []
    }

    const user = req.user
    const comment = req.comment
    if (comment && user) {
      thg.comments.push({
        ts: Date.now(),
        comment,
        user
      })
    }

    if (req.info) {
      const lastActionId = req.actionId
      thg.info = req.forceOverwrite
        ? req.info
        : {
            ...thg.info,
            ...req.info,
            ...(lastActionId ? { lastActionId } : {})
          }
    }

    thg.tags = this._prepThingTags(thg, req.tags, thgPrev)
    const updatedAt = Date.now()
    thg.info = { ...thg.info, updatedAt }

    await this.updateThingHook0(thg, thgPrev)

    await this._storeThingDb(thg)

    this._saveThingDataToMem(thg)

    this.mem.nextAvailableCode = this._generateThingCode(thg)

    await this.reconnectThing(thg)

    return 1
  }

  _checkWriteAccessToThing (req) {
    if (this.ctx.slave) throw new Error('ERR_SLAVE_BLOCK')

    if (!req.thingId || !this.mem.things[req.thingId]) throw new Error('ERR_THING_NOTFOUND')
  }

  async _loadThing (req) {
    const raw = await this.things.get(req.thingId)
    return JSON.parse(raw.value.toString())
  }

  async _saveThing (thg) {
    await this._storeThingDb(thg)
    this._saveThingDataToMem(thg)
  }

  _findCommentIndex (thg, req) {
    // Prioritize ID if provided, fallback to timestamp
    if (req.id) {
      return thg.comments.findIndex(c => c.id === req.id)
    }
    if (req.ts) {
      return thg.comments.findIndex(c => c.ts === req.ts)
    }
    return -1
  }

  _checkCommentPermission (thg, commentIndex, req) {
    if (thg.comments[commentIndex].user !== req.user) {
      throw new Error('ERR_COMMENT_ACCESS_DENIED')
    }
  }

  /**
   * Adds a new comment to a thing.
   * @method saveThingComment
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {string} req.thingId - Thing ID to add comment to
   * @param {string} req.comment - Comment text content
   * @param {string} req.user - Username of comment author
   * @param {string} [req.pos] - Optional position reference
   * @returns {Promise<number>} Returns 1 on success
   * @throws {Error} ERR_SLAVE_BLOCK - Operation blocked on slave/replica nodes
   * @throws {Error} ERR_THING_NOTFOUND - Thing with specified ID not found
   */
  async saveThingComment (req) {
    this._checkWriteAccessToThing(req)

    const thg = await this._loadThing(req)

    if (!Array.isArray(thg.comments)) thg.comments = []

    thg.comments.push({
      id: this._generateThingId(),
      ts: Date.now(),
      comment: req.comment,
      user: req.user,
      ...(req.pos ? { pos: req.pos } : {})
    })

    await this._saveThing(thg)

    return 1
  }

  /**
   * Edits an existing comment on a thing. Only the original author can edit.
   * @method editThingComment
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {string} req.thingId - Thing ID
   * @param {string} [req.id] - Comment ID (preferred identifier)
   * @param {number} [req.ts] - Comment timestamp (fallback if id not provided)
   * @param {string} req.comment - New comment text
   * @param {string} req.user - Username (must match original author)
   * @returns {Promise<number>} Returns 1 on success
   * @throws {Error} ERR_SLAVE_BLOCK - Operation blocked on slave/replica nodes
   * @throws {Error} ERR_THING_NOTFOUND - Thing with specified ID not found
   * @throws {Error} ERR_THING_COMMENTS_NOTFOUND - Thing has no comments
   * @throws {Error} ERR_THING_COMMENT_NOTFOUND - Specified comment not found
   * @throws {Error} ERR_COMMENT_ACCESS_DENIED - User is not the comment author
   */
  async editThingComment (req) {
    this._checkWriteAccessToThing(req)

    const thg = await this._loadThing(req)

    if (!Array.isArray(thg.comments)) throw new Error('ERR_THING_COMMENTS_NOTFOUND')

    const commentIndex = this._findCommentIndex(thg, req)
    if (commentIndex === -1) throw new Error('ERR_THING_COMMENT_NOTFOUND')

    // Ensure only the comment creator can edit it
    this._checkCommentPermission(thg, commentIndex, req)

    thg.comments[commentIndex].comment = req.comment

    await this._saveThing(thg)

    return 1
  }

  /**
   * Deletes a comment from a thing. Only the original author can delete.
   * @method deleteThingComment
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {string} req.thingId - Thing ID
   * @param {string} [req.id] - Comment ID (preferred identifier)
   * @param {number} [req.ts] - Comment timestamp (fallback if id not provided)
   * @param {string} req.user - Username (must match original author)
   * @returns {Promise<number>} Returns 1 on success
   * @throws {Error} ERR_SLAVE_BLOCK - Operation blocked on slave/replica nodes
   * @throws {Error} ERR_THING_NOTFOUND - Thing with specified ID not found
   * @throws {Error} ERR_THING_COMMENTS_NOTFOUND - Thing has no comments
   * @throws {Error} ERR_THING_COMMENT_NOTFOUND - Specified comment not found
   * @throws {Error} ERR_COMMENT_ACCESS_DENIED - User is not the comment author
   */
  async deleteThingComment (req) {
    this._checkWriteAccessToThing(req)

    const thg = await this._loadThing(req)

    if (!Array.isArray(thg.comments)) throw new Error('ERR_THING_COMMENTS_NOTFOUND')

    const commentIndex = this._findCommentIndex(thg, req)
    if (commentIndex === -1) throw new Error('ERR_THING_COMMENT_NOTFOUND')

    // Ensure only the comment creator can delete it
    this._checkCommentPermission(thg, commentIndex, req)

    thg.comments.splice(commentIndex, 1)

    await this._saveThing(thg)

    return 1
  }

  async _forgetThing (thgId) {
    const thg = this.mem.things[thgId]

    if (thg.ctrl) {
      try {
        await thg.ctrl.close()
      } catch (e) { }
    }

    await this.forgetThingHook0(thg)

    await this.things.del(thgId)
    delete this.mem.things[thgId]

    return 1
  }

  /**
   * Removes things from the system based on a query filter.
   * @method forgetThings
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {Object} [req.query] - MongoDB-style query to select things to remove
   * @param {boolean} [req.all=false] - If true, remove all things (ignores query)
   * @returns {Promise<number>} Returns 1 on success
   * @throws {Error} ERR_SLAVE_BLOCK - Operation blocked on slave/replica nodes
   */
  async forgetThings (req) {
    if (this.ctx.slave) {
      throw new Error('ERR_SLAVE_BLOCK')
    }

    if (!req.query) {
      req.query = { id: { $in: [] } }
    }

    if (req.all) {
      req.query = { id: { $exists: true } }
    }

    const thgIds = this._filterThings(req)

    for await (const thgId of thgIds) {
      if (!this.mem.things[thgId]) {
        if (Object.keys(this.mem.things).includes(thgId)) {
          delete this.mem.things[thgId]
        }
        continue
      }

      await this._forgetThing(thgId)
    }

    return 1
  }

  _createApplyThingsProxy () {
    return new Proxy(this, {
      get: (target, property, receiver) => {
        return (...payload) => {
          const [req, thg] = payload
          if (req.method.endsWith('ThingLocApply') && target[req.method] && typeof target[req.method] === 'function') {
            return target[req.method](thg)
          }

          if (thg.ctrl?.[req.method] && typeof thg.ctrl[req.method] === 'function') {
            return thg.ctrl[req.method](...req.params)
          }

          throw new Error('ERR_METHOD_INVALID')
        }
      }
    })
  }

  async reconnectThing (thg) {
    if (thg.ctrl) {
      await this.disconnectThing(thg)
    }
    await this.connectThing(thg)
  }

  async saveThingData (thg) {
    await this._saveThingDataToDb(thg)
    this._saveThingDataToMem(thg)
  }

  async _saveThingDataToDb (thg) {
    let thgDb = await this.things.get(thg.id)
    thgDb = JSON.parse(thgDb.value.toString())

    if (thg.opts) thgDb.opts = thg.opts
    if (thg.info) thgDb.info = thg.info
    if (thg.tags) thgDb.tags = thg.tags
    if (thg.code) thgDb.code = thg.code

    await this._storeThingDb(thgDb)
  }

  _saveThingDataToMem (thg) {
    const thgMem = this.mem.things[thg.id]
    if (thg.opts) thgMem.opts = thg.opts
    if (thg.info) thgMem.info = thg.info
    if (thg.tags) thgMem.tags = thg.tags
    if (thg.code) thgMem.code = thg.code
    if (thg.comments) thgMem.comments = thg.comments
  }

  async _storeThingDb (thg) {
    await this.things.put(thg.id, Buffer.from(JSON.stringify(thg)))
  }

  async _saveAlerts () {
    const log = await lWrkFunLogs.getBeeTimeLog.call(this, 'thing-alerts', 0, true)
    for (const thg of Object.values(this.mem.things)) {
      if (thg.last?.alerts) {
        try {
          await this._storeThgAlertsToDb(thg.id, log, thg.last.alerts)
        } catch (error) {
          this.debugError(`ERR_STORE_ALERTS_TO_DB thg:${thg.id}`, error.message)
        }
      }
    }
    await lWrkFunLogs.releaseBeeTimeLog.call(this, log)
  }

  async _storeThgAlertsToDb (thingId, log, alerts = []) {
    if (!Array.isArray(alerts)) {
      return
    }
    const groupedAlerts = alerts.reduce((grouped, alert) => {
      const { createdAt, uuid } = alert
      grouped[createdAt] ??= {}
      grouped[createdAt][uuid] = { ...alert, thingId }
      return grouped
    }, {})

    const timestamps = Object.keys(groupedAlerts)

    for (const timestamp of timestamps) {
      const existingLogEntry = await log.get(utilsStore.convIntToBin(timestamp))
      const existingAlerts = existingLogEntry?.value ? JSON.parse(existingLogEntry.value.toString()) : {}

      const updatedAlerts = { ...existingAlerts, ...groupedAlerts[timestamp] }
      await log.put(
        utilsStore.convIntToBin(timestamp),
        Buffer.from(JSON.stringify(updatedAlerts))
      )
    }
  }

  async _getLogs (req, logKey, errorMsg, transformFn) {
    const offset = req.offset || 0
    const log = await lWrkFunLogs.getBeeTimeLog.call(this, logKey, offset)

    if (!log) {
      throw new Error(errorMsg)
    }

    const res = await this._parseHistLog(log, {
      reverse: true,
      limit: req.limit,
      start: req.start,
      end: req.end
    })

    if (!Array.isArray(res)) {
      throw new Error('ERR_HIST_LOG_NOTFOUND')
    }

    await lWrkFunLogs.releaseBeeTimeLog.call(this, log)
    return transformFn(res, req)
  }

  _transformAlerts (res, req) {
    const flattenedAlerts = res.flatMap(log => Object.values(log)).slice(0, req.limit)
    return flattenedAlerts.map(alert => {
      const { thingId, ...rest } = alert
      const alertThing = this.mem.things[thingId]
      const thing = gLibUtilBase.pick(alertThing, ['id', 'info', 'tags', 'type', 'code'])
      return { ...rest, thing }
    })
  }

  _transformInfoHistory (res, req) {
    const flattenedHistory = res.flat(1).slice(0, req.limit)
    const historyWithCurrentThingInfo = flattenedHistory.map(change => {
      const { id, ...rest } = change
      const historyThing = this.mem.things[id]
      const thing = gLibUtilBase.pick(historyThing, ['id', 'info', 'tags', 'type', 'code'])
      return { ...rest, thing }
    })

    return gLibUtilBase.isEmpty(req.fields) ? historyWithCurrentThingInfo : this._projection(historyWithCurrentThingInfo, req.fields)
  }

  /**
   * Retrieves historical logs (alerts or info changes).
   * @method getHistoricalLogs
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {'alerts'|'info'} req.logType - Type of historical logs to retrieve
   * @param {number} [req.offset=0] - Starting offset
   * @param {number} [req.limit=100] - Maximum entries to return
   * @param {number} [req.start] - Start timestamp for time range filter
   * @param {number} [req.end] - End timestamp for time range filter
   * @param {Object} [req.query] - MongoDB-style query filter applied to results
   * @param {Object} [req.fields] - Field projection (for 'info' type only)
   * @returns {Promise<Array>} Array of historical log entries with associated thing info
   * @throws {Error} ERR_INFO_HISTORY_LOG_TYPE_INVALID - logType parameter missing or invalid
   */
  async getHistoricalLogs (req) {
    const logType = req.logType
    if (!logType) {
      throw new Error('ERR_INFO_HISTORY_LOG_TYPE_INVALID')
    }
    if (logType === 'alerts') {
      const logs = await this._getLogs(
        req,
        'thing-alerts',
        'ERR_LOG_NOTFOUND',
        this._transformAlerts.bind(this)
      )
      // Filter at the rack (e.g. by thing.type); sort/pagination stay with the caller.
      if (gLibUtilBase.isNil(req.query)) return logs
      return this._applyFilters(logs, { query: req.query }, true)
    }
    if (logType === 'info') {
      const logs = await this._getLogs(
        req,
        'thing-history-log',
        'ERRs_INFO_HISTORY_LOG_NOTFOUND',
        this._transformInfoHistory.bind(this)
      )
      const filteredLogs = this._applyFilters(
        logs,
        { ...req, offset: req.offset ?? 0, limit: req.limit ?? 100 },
        true
      )
      return filteredLogs
    }
  }

  /**
   * Executes a method on multiple things matching a query filter.
   * @method applyThings
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {string} req.method - Method name to execute on each thing's controller
   * @param {Object} [req.query] - MongoDB-style query to select things (default: all)
   * @param {any[]} [req.params=[]] - Parameters to pass to the method
   * @param {Object} [req.fields] - Field projection for thing selection
   * @param {Object} [req.sort] - Sort criteria for thing selection
   * @param {number} [req.offset] - Number of things to skip
   * @param {number} [req.limit] - Maximum number of things to process
   * @returns {Promise<number>} Number of successful operations
   * @throws {Error} ERR_SLAVE_BLOCK - Operation blocked on slave/replica nodes
   * @throws {Error} ERR_METHOD_INVALID - Method parameter missing or invalid
   */
  async applyThings (req) {
    if (this.ctx.slave) {
      throw new Error('ERR_SLAVE_BLOCK')
    }

    const thingConf = this.conf.thing
    const things = this.mem.things
    const method = req.method

    if (!method) {
      throw new Error('ERR_METHOD_INVALID')
    }

    const thgIds = this._filterThings(req)

    const res = await async.mapLimit(
      things, thingConf.thingQueryConcurrency,
      async (thg, thgId) => {
        if (!thgIds.includes(thg.id)) {
          return 0
        }

        let done = 0

        try {
          await this._handler.call(req, thg)
          done = 1
        } catch (e) {
          this.debugThingError(thg, e)
        }

        return done
      }
    )

    const total = res.reduce((acc, e) => acc + e, 0)

    return total
  }

  async _queryThingHook () {
    // no op
  }

  /**
   * Executes a method on a specific thing's controller.
   * @method queryThing
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {string} req.id - Thing ID
   * @param {string} req.method - Method name to execute on the thing's controller
   * @param {any[]} req.params - Parameters to pass to the method
   * @returns {Promise<any>} Result from the method execution
   * @throws {Error} ERR_THING_NOTFOUND - Thing with specified ID not found
   * @throws {Error} ERR_THING_NOT_INITIALIZED - Thing controller not ready/connected
   * @throws {Error} ERR_THING_METHOD_NOTFOUND - Method does not exist on thing controller
   */
  async queryThing (req) {
    const thg = this.mem.things[req.id]

    if (!thg) {
      throw new Error('ERR_THING_NOTFOUND')
    }

    if (!thg.ctrl) {
      throw new Error('ERR_THING_NOT_INITIALIZED')
    }

    if (!thg.ctrl[req.method]) {
      throw new Error('ERR_THING_METHOD_NOTFOUND')
    }

    const res = await thg.ctrl[req.method](...req.params)
    await this._queryThingHook(req, res)
    return res
  }

  _prepThingInfo (thg, opts = {}) {
    const pack = {
      id: thg.id,
      code: thg.code,
      type: thg.type,
      tags: thg.tags,
      info: thg.info,
      rack: this.rackId,
      comments: thg.comments,
      ...this.selectThingInfo(thg)
    }

    if (opts.status) {
      pack.last = thg.last
    }

    return pack
  }

  _applyFilters (things, req, returnObjects = false) {
    if (!gLibUtilBase.isNil(req.query) || !gLibUtilBase.isNil(req.fields)) {
      const query = new mingo.Query(req.query || {})
      things = query.find(things, req.fields || {}).all()
    }
    /*
      Mingo's built-in sorter does not support custom sorting functions.
      To address this limitation, we use our own custom sorter function.

      Since we have already converted the cursor to an array for sorting,
      we avoid converting the data back into a cursor for offset and limit operations.

      This approach is feasible as all data is stored in memory, making the cursor redundant
      for optimization purposes in this specific case.
     */

    // The order of actions (sort, offset, limit) is critical to ensure accurate results.
    if (!gLibUtilBase.isNil(req.sort)) {
      things = things.sort((a, b) => getThingSorter(a, b, req.sort))
    }
    if (req.offset) {
      things = things.slice(req.offset)
    }
    if (!gLibUtilBase.isNil(req.limit)) {
      things = things.slice(0, req.limit)
    }

    if (returnObjects) return things

    return things.map(e => {
      return e.id
    })
  }

  _filterThings (req, returnObjects = false) {
    const things = Object.values(this.mem.things)
    return this._applyFilters(things, req, returnObjects)
  }

  _projection (data, fields = {}) {
    const query = new mingo.Query({})
    const cursor = query.find(data, fields)
    return cursor.all()
  }

  /**
   * Lists things with optional filtering, pagination, and sorting.
   * @method listThings
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {Object} [req.query] - MongoDB-style query filter
   * @param {Object} [req.fields] - Field projection for results
   * @param {Object} [req.sort] - Sort criteria (e.g., { 'info.createdAt': -1 })
   * @param {number} [req.offset=0] - Number of records to skip
   * @param {number} [req.limit=100] - Maximum records to return
   * @param {boolean} [req.status=false] - Include last status/snapshot information
   * @returns {Array<Object>} Array of thing objects matching the query
   */
  listThings (req) {
    const thgs = this._filterThings({
      ...req,
      offset: req.offset ?? 0,
      limit: req.limit ?? 100
    }, true)

    const res = thgs.map(thg => {
      const pack = this._prepThingInfo(thg, { status: req.status })
      return pack
    })
    return res
  }

  /**
   * Returns the count of things matching an optional query filter.
   * @method getThingsCount
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {Object} [req.query] - MongoDB-style query filter
   * @returns {number} Count of things matching the query
   */
  getThingsCount (req) {
    let things = Object.values(this.mem.things)

    if (req.query) {
      const query = new mingo.Query(req.query)
      things = query.find(things).all()
    }

    return things.length
  }

  /**
   * Returns rack information including ID and RPC public key.
   * @method getRack
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters (currently unused)
   * @returns {Object} Rack information
   * @returns {string} returns.id - Rack identifier
   * @returns {string} returns.rpcPubKey - RPC server public key (hex encoded)
   */
  getRack (req) {
    return {
      id: this.rackId,
      rpcPubKey: this.getRpcKey().toString('hex')
    }
  }

  async _getLogResponse (req, offset) {
    const log = await lWrkFunLogs.getBeeTimeLog.call(this, `${req.key}-${req.tag}`, offset)

    if (!log) {
      throw new Error('ERR_LOG_NOTFOUND')
    }

    const res = await this._parseHistLog(log, {
      reverse: true,
      limit: req.limit,
      start: req.start,
      end: req.end
    })
    await lWrkFunLogs.releaseBeeTimeLog.call(this, log)
    return res
  }

  _getDefaultTaillogLimit (req) {
    const { limit, start, end } = req
    return limit || (start || end ? undefined : 100)
  }

  async _getTailLogWithOffset (req, offset) {
    const timeframes = this.statTimeframes
    const { start, end, key } = req
    const limit = this._getDefaultTaillogLimit(req)
    const numberOfLogsInRange = getLogsCountForTimeRange(
      start,
      end,
      key,
      timeframes
    )
    const logMaxHeight = getLogMaxHeight(this.conf.thing.logKeepCount)

    if (!numberOfLogsInRange && !limit) return await this._getLogResponse(req, offset)

    const remaining =
      numberOfLogsInRange && limit
        ? Math.min(numberOfLogsInRange, limit)
        : numberOfLogsInRange || limit

    let allLogs = []
    if (offset >= logMaxHeight) return await this._getLogResponse(req, offset)
    while (allLogs.length < remaining && offset <= logMaxHeight) {
      try {
        const logs = await this._getLogResponse(req, offset++)
        if (!Array.isArray(logs)) break

        allLogs = allLogs.concat(logs).slice(0, remaining)
      } catch (error) {
        if (allLogs.length === 0) throw error
        break
      }
    }

    return allLogs
  }

  /**
   * Retrieves time-series log data for a specific thing or statistic.
   * @method tailLog
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {string} req.key - Log type identifier (e.g., 'thing-5m', 'stat-H', 'stat-D')
   * @param {string} req.tag - Thing tag or identifier
   * @param {number} [req.offset=0] - Log file offset for pagination
   * @param {number} [req.limit] - Maximum entries (default 100 if no time range specified)
   * @param {number} [req.start] - Start timestamp for time range filter
   * @param {number} [req.end] - End timestamp for time range filter
   * @param {Object} [req.fields] - Field projection for results
   * @param {string} [req.groupRange] - Group logs by time range for aggregation
   * @param {boolean} [req.shouldCalculateAvg] - Calculate averages when grouping
   * @returns {Promise<Array>} Array of log entries
   * @throws {Error} ERR_LOG_KEY_NOTFOUND - key parameter missing
   * @throws {Error} ERR_LOG_TAG_INVALID - tag parameter missing or invalid
   * @throws {Error} ERR_LOG_NOTFOUND - Requested log not found
   */
  async tailLog (req) {
    if (!req.key) {
      throw new Error('ERR_LOG_KEY_NOTFOUND')
    }
    const offset = req.offset || 0

    if (!req.tag) {
      throw new Error('ERR_LOG_TAG_INVALID')
    }

    const res = await this._getTailLogWithOffset(req, offset)

    // verify/update inconsistent log structure
    await this.tailLogHook0(res, req)

    if (req.groupRange) {
      const aggregated = aggregateLogs(res, req.groupRange, req.shouldCalculateAvg)

      if (!gLibUtilBase.isEmpty(req.fields)) {
        return this._projection(aggregated, req.fields)
      }
      return aggregated
    }

    // apply mingo projection to return specific fields
    if (!gLibUtilBase.isEmpty(req.fields)) {
      return this._projection(res, req.fields)
    }

    return res
  }

  async _parseHistLog (log, req) {
    const query = {}

    if (req.start) {
      const kstart = utilsStore.convIntToBin(req.start)
      query.gte = kstart
    }

    if (req.end) {
      const kend = utilsStore.convIntToBin(req.end)
      query.lte = kend
    }

    if (req.limit) {
      query.limit = req.limit
    }

    if (req.reverse) {
      query.reverse = true
    }

    if (req.startExcl) {
      const kstartExcl = utilsStore.convIntToBin(req.startExcl)
      query.gt = kstartExcl
    }

    if (req.endExcl) {
      const kendExcl = utilsStore.convIntToBin(req.endExcl)
      query.lt = kendExcl
    }

    const stream = log.createReadStream(query)

    const res = []

    for await (const chunk of stream) {
      res.push(JSON.parse(chunk.value.toString()))
    }

    return res
  }

  /**
   * Returns the replica configuration for this worker.
   * @method getReplicaConf
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters (currently unused)
   * @returns {Promise<Object>} Replica configuration with key mappings
   */
  async getReplicaConf (req) {
    return lWrkFunReplica.getReplicaConf.call(this, req, lWrkFunLogs)
  }

  /**
   * Returns extended worker data. Override _getWrkExtData in subclasses to provide custom data.
   * @method getWrkExtData
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters (passed to _getWrkExtData)
   * @returns {Promise<Object>} Extended worker data (empty object by default)
   */
  async getWrkExtData (req) {
    return this._getWrkExtData(req)
  }

  /**
   * Returns the current worker settings.
   * @method getWrkSettings
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters (currently unused)
   * @returns {Promise<Object>} Current worker settings
   */
  async getWrkSettings (req) {
    return await lWrkFunSettings.getSettings.call(this)
  }

  /**
   * Saves worker settings entries.
   * @method saveWrkSettings
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {Object} req.entries - Settings entries to save (key-value pairs)
   * @returns {Promise<any>} Result from settings save operation
   * @throws {Error} ERR_ENTRIES_INVALID - entries parameter missing or invalid
   */
  async saveWrkSettings (req) {
    if (!req.entries) throw new Error('ERR_ENTRIES_INVALID')

    return await lWrkFunSettings.saveSettingsEntries.call(this, req.entries)
  }

  /**
   * Initiates a rack reboot by stopping the worker process.
   * @method rackReboot
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters (currently unused)
   * @returns {number} Returns 1 immediately (process exits asynchronously)
   */
  rackReboot (req) {
    this.stop(() => {
      return exit(-1)
    })
    return 1
  }

  async buildStats (sk, fireTime) {
    // save real time data
    if (sk === STAT_RTD) {
      return await this._saveRealTimeData()
    }

    return lWrkFunStats.buildStats.call(this, sk, fireTime)
  }

  async _saveRealTimeData () {
    if (this._collectingRtd) return
    this._collectingRtd = true

    const things = this.mem.things
    const thgsRtd = {}
    async.eachLimit(things, this.conf.thing.thingRtdConcurrency || 500, async (thg) => {
      thgsRtd[thg.id] = thg
      if (!thg.ctrl) return
      try {
        const rtd = await thg.ctrl.getRealtimeData()
        if (!rtd) return

        // creating last.snap props for aggrStats
        thgsRtd[thg.id] = { ...thg, last: { snap: rtd, alerts: lWrkFunAlerts.processThingAlerts.call(this, thg) } }
      } catch (e) {
        this.debugThingError(thg, e)
      }
    },
    async () => {
      this._collectingRtd = false
      if (!Object.keys(thgsRtd).length) return

      try {
        const aggrData = lWrkFunStats.aggrStats.call(this, Object.keys(thgsRtd), {}, thgsRtd)
        const log = await lWrkFunLogs.getBeeTimeLog.call(this, `${STAT_RTD}-t-${this._getThingBaseType()}`, 0, true)
        await log.put(STAT_RTD, Buffer.from(JSON.stringify(aggrData)))
        await lWrkFunLogs.releaseBeeTimeLog.call(this, log)
      } catch (e) {
        this.debugError('ERR_SAVING_RTD', e)
      }
    })
  }

  /**
   * Returns the global worker configuration with optional field projection.
   * @method getWrkConf
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {Object} [req.fields] - Field projection to limit returned fields
   * @returns {Promise<Object>} Global configuration object (or projected subset)
   * @throws {Error} ERR_GLOBAL_CONFIG_MISSING - Global config not loaded
   */
  async getWrkConf (req) {
    const fields = req.fields || {}
    if (!this.conf?.globalConfig) {
      throw new Error('ERR_GLOBAL_CONFIG_MISSING')
    }
    return this._projection([this.conf.globalConfig], fields)?.[0]
  }

  /**
   * Returns thing-related configuration values.
   * @method getThingConf
   * @memberof WrkProcVar
   * @param {Object} req - Request parameters
   * @param {'nextAvailableCode'} req.requestType - Type of configuration to retrieve
   * @returns {Promise<string>} For 'nextAvailableCode': the next available thing code
   * @throws {Error} ERR_INVALID_REQUEST_TYPE - requestType is not 'nextAvailableCode'
   */
  async getThingConf (req) {
    if (req.requestType !== 'nextAvailableCode') {
      throw new Error('ERR_INVALID_REQUEST_TYPE')
    }
    return this.mem.nextAvailableCode
  }

  async getDbMeta () {
    // return array of cores' name, key, keyEncoding
    const keys = []

    // add main db key
    keys.push({
      name: MAIN_DB,
      key: this.db.core.key.toString('hex'),
      encoding: 'utf-8'
    })

    const metaStream = this.meta_logs.createReadStream({})
    for await (const { key, value } of metaStream) {
      const meta = JSON.parse(value.toString())

      for (let i = 0; i <= meta.cur; i++) {
        const log = await lWrkFunLogs.getBeeTimeLog.call(this, key, i)
        if (log) {
          keys.push({
            name: `${lWrkFunLogs.getLogName(key)}-${i}`,
            key: log.core.key.toString('hex'),
            encoding: 'binary'
          })
          await lWrkFunLogs.releaseBeeTimeLog.call(this, log)
        }
      }
    }
    return keys
  }

  _start (cb) {
    async.series([
      next => { super._start(next) },
      async () => {
        const thingConf = this.conf.thing

        this.scheduleAddlStatConfigTfs = this.conf.thing.scheduleAddlStatConfigTfs || []
        this.statTimeframes = gLibStats.defaults.timeframes
        if (Array.isArray(this.scheduleAddlStatTfs)) {
          this.statTimeframes = this.statTimeframes.concat(this.scheduleAddlStatTfs)
        }
        if (Array.isArray(this.scheduleAddlStatConfigTfs)) {
          this.statTimeframes = this.statTimeframes.concat(this.scheduleAddlStatConfigTfs)
        }

        await this.net_r0.startRpcServer()
        const rpcServer = this.net_r0.rpcServer

        if (this.ctx.slave) {
          if (this.status.replica_conf) {
            this.mem.replica_conf = this.status.replica_conf
          } else {
            await lWrkFunReplica.refreshReplicaConf.call(this)
          }

          if (!this.mem.replica_conf) {
            throw new Error('ERR_REPLICA_FAILED')
          }

          this.db = await this.store_s1.getBee(
            { key: Buffer.from(lWrkFunReplica.calcReplicaKey.call(this, 'main', 0), 'hex') },
            { keyEncoding: 'utf-8' }
          )
        } else {
          this.db = await this.store_s1.getBee(
            { name: MAIN_DB },
            { keyEncoding: 'utf-8' }
          )
        }

        await this.db.ready()

        this.things = this.db.sub('things')
        this.meta_logs = this.db.sub('meta_logs_00')
        this.settings = this.db.sub('settings')

        rpcServer.respond('echo', x => x)

        RPC_METHODS.forEach(method => {
          rpcServer.respond(method, async (req) => {
            if (AUDIT_METHODS.has(method)) {
              return this.handleRpcReply(method, req)
            }
            return await this.net_r0.handleReply(method, req)
          })
        })

        thingConf.thingQueryConcurrency = thingConf.thingQueryConcurrency || 25
        thingConf.storeSnapItvMs = thingConf.storeSnapItvMs || 300000
        thingConf.collectSnapTimeoutMs = thingConf.collectSnapTimeoutMs || 120000

        this.status.rpcPublicKey = this.getRpcKey().toString('hex')
        this.status.storeS1PrimaryKey = this.store_s1.store.primaryKey.toString('hex')

        // rpc client key to be allowed through destination server firewall
        this.status.rpcClientKey = this.net_r0.dht.defaultKeyPair.publicKey.toString('hex')
        this.saveStatus()

        if (thingConf.replicaDiscoveryKey) {
          lWrkFunReplica.startReplica.call(this, thingConf.replicaDiscoveryKey)
        }

        debug(`RACK-ID=${this.rackId}`)
      },
      async () => {
        await this.setupThings()

        const thingConf = this.conf.thing

        if (this.ctx.slave) {
          this.interval_0.add(
            'setupThings',
            this.setupThings.bind(this),
            thingConf.refreshThingsItvMs || 60000
          )

          this.interval_0.add(
            'refreshReplicaConf',
            lWrkFunReplica.refreshReplicaConf.bind(this),
            thingConf.refreshReplicaConfItvMs || 30000
          )
        } else {
          this.interval_0.add(
            'collectSnaps',
            this.collectSnaps.bind(this),
            thingConf.collectSnapsItvMs || 60000
          )

          this.interval_0.add(
            'rotateLogs',
            lWrkFunLogs.rotateLogs.bind(this),
            thingConf.rotateLogsItvMs || 120000
          )
        }

        if (thingConf.replicaDiscoveryKey || !this.ctx.slave) {
          this.interval_0.add(
            'refreshLogsCache',
            lWrkFunLogs.refreshLogsCache.bind(this),
            thingConf.refreshLogsCacheItvMs || 60000
          )
        }

        for (const tfs of this.statTimeframes) {
          const sk = `stat-${tfs[0]}`
          this.scheduler_0.add(sk, (fireTime) => {
            this.buildStats(sk, fireTime)
          }, tfs[1])
        }
      },
      (next) => {
        this.miningosThgWriteCalls_0.bindWriteCalls('net_r0')
        this.miningosThgWriteCalls_0.whitelistActions([
          ['rackReboot', 2] // [action, reqVotes]
        ])

        next()
      }
    ], cb)
  }
}

module.exports = WrkProcVar
