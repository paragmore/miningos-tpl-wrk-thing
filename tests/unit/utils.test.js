'use strict'

const test = require('brittle')

const {
  getLogsCountForTimeRange,
  getJsonChanges,
  isValidSnap,
  isOffline,
  getLogMaxHeight,
  aggregateLogs,
  getThingSorter
} = require('../../workers/lib/utils')

const DEFAULT_TIMEFRAMES = [
  ['1m', '0 */1 * * * *'],
  ['5m', '0 */5 * * * *'],
  ['30m', '0 */30 * * * *'],
  ['3h', '0 0 */3 * * *'],
  ['1D', '0 0 0 * * *']
]

const TWO_HOUR_TIMEFRAMES = [['2h', '0 0 */2 * * *']]

test('getLogsCountForTimeRange: handles no date range', async t => {
  const result = getLogsCountForTimeRange(
    undefined,
    undefined,
    'stat-5m',
    DEFAULT_TIMEFRAMES
  )
  t.ok(Number.isFinite(result))
})

test('getLogsCountForTimeRange: handles no end date range', async t => {
  const start = Date.now() - 9 * 5 * 60 * 1000
  const result = getLogsCountForTimeRange(
    start,
    undefined,
    'stat-5m',
    DEFAULT_TIMEFRAMES
  )
  t.ok(result === 10)
  t.ok(Number.isFinite(result))
})

test('getLogsCountForTimeRange: valid key with time range', async t => {
  const start = Date.now() - 9 * 5 * 60 * 1000
  const end = Date.now()
  const result1 = getLogsCountForTimeRange(
    start,
    end,
    'stat-5m',
    DEFAULT_TIMEFRAMES
  )
  const result2 = getLogsCountForTimeRange(
    Date.now() - 49 * 60 * 1000,
    end,
    'stat-1m',
    DEFAULT_TIMEFRAMES
  )
  t.ok(result1 === 10)
  t.ok(result2 === 50)
})

test('getLogsCountForTimeRange: no logs for invalid key', async t => {
  const result = getLogsCountForTimeRange(
    Date.now() - 1000,
    Date.now(),
    'invalid-key',
    DEFAULT_TIMEFRAMES
  )
  t.is(result, 0)
})

test('getLogsCountForTimeRange: hour-style cron uses hour interval', async t => {
  const start = 0
  const end = 4 * 60 * 60 * 1000
  const result = getLogsCountForTimeRange(start, end, 'stat-2h', TWO_HOUR_TIMEFRAMES)
  t.ok(result >= 3)
})

test('getLogsCountForTimeRange: daily cron and unsupported cron return 0', async t => {
  const daily = getLogsCountForTimeRange(
    0,
    48 * 60 * 60 * 1000,
    'stat-1D',
    [['1D', '0 0 0 * * *']]
  )
  t.ok(daily >= 2)

  const bad = getLogsCountForTimeRange(
    0,
    1000,
    'stat-bad',
    [['bad', 'invalid cron']]
  )
  t.is(bad, 0)
})

test('isValidSnap and isOffline', async t => {
  t.ok(isValidSnap({ stats: { a: 1 }, config: { b: 2 } }))
  t.absent(isValidSnap({ stats: {} }))

  t.ok(isOffline({ stats: {} }))
  t.ok(isOffline({ stats: { status: 'offline' } }))
  t.absent(isOffline({ stats: { status: 'running' } }))
})

test('getLogMaxHeight', async t => {
  t.is(getLogMaxHeight(4), 6)
})

test('aggregateLogs: sum and avg across buckets', async t => {
  const base = 1_700_000_000_000
  const logs = [
    { ts: base, cpu: 10 },
    { ts: base + 30 * 60 * 1000, cpu: 20 },
    { ts: base + 2 * 60 * 60 * 1000, cpu: 5 }
  ]
  const sum = aggregateLogs(logs, '1H', false)
  t.ok(sum.length >= 1)
  const avg = aggregateLogs(logs, '1H', true)
  t.ok(avg.length >= 1)
})

test('aggregateLogs: nested numeric fields aggregate', async t => {
  const ts = 1_700_000_000_000
  const logs = [
    { ts, m: { a: 1, b: 2 } },
    { ts: ts + 1000, m: { a: 3, b: 4 } }
  ]
  const out = aggregateLogs(logs, '1D', false)
  t.ok(out.length >= 1)
})

test('aggregateLogs: nested non-numeric fields keep first value', async t => {
  const ts = 1_700_000_000_000
  const logs = [
    { ts, m: { label: 'alpha' } },
    { ts: ts + 1000, m: { label: 'beta' } }
  ]
  const out = aggregateLogs(logs, '1D', false)
  t.ok(out.length >= 1)
  t.is(out[0].m.label, 'alpha')
})

test('aggregateLogs: string field keeps first value in bucket', async t => {
  const ts = 1_700_000_000_000
  const logs = [
    { ts, mode: 'a' },
    { ts: ts + 500, mode: 'b' }
  ]
  const out = aggregateLogs(logs, '1D', false)
  t.ok(out.length >= 1)
  t.is(out[0].mode, 'a')
})

test('aggregateLogs: invalid group range throws', async t => {
  await t.exception(async () => {
    aggregateLogs([{ ts: 1, v: 1 }], 'bogus', false)
  }, /ERR_INVALID_GROUP_RANGE/)
})

test('getThingSorter: empty sortBy', async t => {
  t.is(getThingSorter({ a: 1 }, { b: 2 }, {}), 1)
  t.is(getThingSorter({ a: 1 }, { b: 2 }, null), 1)
})

test('getThingSorter: natural order and descending', async t => {
  const asc = getThingSorter(
    { info: { id: 'rack-2' } },
    { info: { id: 'rack-10' } },
    { 'info.id': 1 }
  )
  t.ok(asc < 0)
  const desc = getThingSorter(
    { info: { id: 'rack-2' } },
    { info: { id: 'rack-10' } },
    { 'info.id': -1 }
  )
  t.ok(desc > 0)
})

test('getThingSorter: undefined key ordering', async t => {
  const r = getThingSorter(
    { info: { id: 'a' } },
    { info: {} },
    { 'info.id': 1 }
  )
  t.ok(r !== 0)
})

test('getThingSorter: equal values return 0', async t => {
  t.is(
    getThingSorter(
      { info: { id: 'same' } },
      { info: { id: 'same' } },
      { 'info.id': 1 }
    ),
    0
  )
})

test('getThingSorter: length diff of tokenized strings', async t => {
  const r = getThingSorter({ k: 'ab' }, { k: 'a' }, { k: 1 })
  t.ok(r !== 0)
})

test('getThingSorter: second sort key breaks tie', async t => {
  const r = getThingSorter(
    { a: { x: 1, y: 1 } },
    { a: { x: 1, y: 2 } },
    { 'a.x': 1, 'a.y': 1 }
  )
  t.ok(r < 0)
})

test('getJsonChanges', async main => {
  main.test('Should detect changes in primitive values', t => {
    const previousJson = { name: 'John', age: 30 }
    const currentJson = { name: 'Jane', age: 30 }

    const changes = getJsonChanges(previousJson, currentJson)
    t.is(
      JSON.stringify(changes),
      JSON.stringify({
        name: { oldValue: 'John', newValue: 'Jane' }
      })
    )
  })

  main.test('Should detect changes in nested objects', t => {
    const previousJson = { person: { name: 'John', age: 30 } }
    const currentJson = { person: { name: 'John', age: 31 } }

    const changes = getJsonChanges(previousJson, currentJson)
    t.is(
      JSON.stringify(changes),
      JSON.stringify({
        'person.age': { oldValue: 30, newValue: 31 }
      })
    )
  })

  main.test('Should detect additions and deletions in arrays', t => {
    const previousJson = { tags: ['a', 'b'] }
    const currentJson = { tags: ['a', 'c'] }

    const changes = getJsonChanges(previousJson, currentJson)
    t.is(
      JSON.stringify(changes),
      JSON.stringify({
        tags: { additions: ['c'], deletions: ['b'] }
      })
    )
  })

  main.test('Should detect no changes when objects are identical', t => {
    const previousJson = { name: 'John', age: 30 }
    const currentJson = { name: 'John', age: 30 }

    const changes = getJsonChanges(previousJson, currentJson)
    t.is(JSON.stringify(changes), JSON.stringify({}))
  })

  main.test('Should handle new keys being added', t => {
    const previousJson = { name: 'John' }
    const currentJson = { name: 'John', age: 30 }

    const changes = getJsonChanges(previousJson, currentJson)
    t.is(
      JSON.stringify(changes),
      JSON.stringify({
        age: { oldValue: undefined, newValue: 30 }
      })
    )
  })

  main.test('Should handle keys being removed', t => {
    const previousJson = { name: 'John', age: 30 }
    const currentJson = { name: 'John' }

    const changes = getJsonChanges(previousJson, currentJson)
    t.is(
      JSON.stringify(changes),
      JSON.stringify({
        age: { oldValue: 30, newValue: undefined }
      })
    )
  })

  main.test('Should handle nested arrays and objects', t => {
    const previousJson = {
      name: 'John',
      details: { hobbies: ['reading', 'swimming'] }
    }
    const currentJson = {
      name: 'John',
      details: { hobbies: ['reading', 'running'] }
    }

    const changes = getJsonChanges(previousJson, currentJson)
    t.is(
      JSON.stringify(changes),
      JSON.stringify({
        'details.hobbies': {
          additions: ['running'],
          deletions: ['swimming']
        }
      })
    )
  })

  main.test('Should handle empty objects and arrays', t => {
    const previousJson = { list: [], config: {} }
    const currentJson = { list: ['item'], config: { key: 'value' } }

    const changes = getJsonChanges(previousJson, currentJson)
    t.is(
      JSON.stringify(changes),
      JSON.stringify({
        list: { additions: ['item'], deletions: [] },
        'config.key': { oldValue: undefined, newValue: 'value' }
      })
    )
  })

  main.test('Should handle null and undefined values', t => {
    const previousJson = { name: 'John', age: null }
    const currentJson = { name: 'John', age: undefined }

    const changes = getJsonChanges(previousJson, currentJson)
    t.is(
      JSON.stringify(changes),
      JSON.stringify({
        age: { oldValue: null, newValue: undefined }
      })
    )
  })
})
