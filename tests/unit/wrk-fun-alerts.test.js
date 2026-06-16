'use strict'

const test = require('brittle')
const { processThingAlerts } = require('../../workers/lib/wrk-fun-alerts')

test('wrk-fun-alerts: processThingAlerts with no lib', async t => {
  const mockWorker = {
    loadLib: () => null
  }

  const result = processThingAlerts.call(mockWorker, {})
  t.is(result, null)
})

test('wrk-fun-alerts: processThingAlerts with no alerts config', async t => {
  const mockWorker = {
    loadLib: () => ({ specs: {} }),
    conf: { thing: {} }
  }

  const result = processThingAlerts.call(mockWorker, { type: 'miner' })
  t.is(result, null)
})

test('wrk-fun-alerts: processThingAlerts with no thing type config', async t => {
  const mockWorker = {
    loadLib: () => ({ specs: {} }),
    conf: { thing: { alerts: {} } }
  }

  const result = processThingAlerts.call(mockWorker, { type: 'miner' })
  t.is(result, null)
})

test('wrk-fun-alerts: processThingAlerts with no snap', async t => {
  const mockWorker = {
    loadLib: () => ({ specs: {} }),
    conf: { thing: { alerts: { miner: {} } } },
    getSpecTags: () => []
  }

  const thing = { type: 'miner', last: { err: 'No snap' } }
  const result = processThingAlerts.call(mockWorker, thing)

  t.ok(Array.isArray(result))
  t.is(result.length, 1)
  t.is(result[0].name, 'error_snap')
  t.is(result[0].code, 'error_snap')
  t.is(result[0].severity, 'medium')
})

test('wrk-fun-alerts: processThingAlerts with errors from snap', async t => {
  const mockWorker = {
    loadLib: () => ({ specs: {} }),
    conf: {
      thing: {
        alerts: {
          miner: {
            test_error: { description: 'Test error', severity: 'high' }
          }
        }
      }
    },
    getSpecTags: () => []
  }

  const thing = {
    type: 'miner',
    last: {
      snap: {
        raw_errors: [{
          name: 'test_error',
          code: 'TEST_ERR',
          timestamp: Date.now(),
          message: 'Test error message'
        }]
      }
    }
  }

  const result = processThingAlerts.call(mockWorker, thing)

  t.ok(Array.isArray(result))
  t.is(result.length, 1)
  t.is(result[0].name, 'test_error')
  t.is(result[0].code, 'TEST_ERR')
  t.is(result[0].severity, 'high')
  t.is(result[0].message, 'Test error message')
})

test('wrk-fun-alerts: processThingAlerts with spec validation', async t => {
  const mockWorker = {
    loadLib: () => ({
      specs: {
        miner: {
          test_alert: {
            valid: () => true,
            probe: () => ({ test: 'data' })
          }
        }
      }
    }),
    conf: {
      thing: {
        alerts: {
          miner: {
            test_alert: {
              name: 'Test Alert',
              code: 'TEST_ALERT',
              description: 'Test alert description',
              severity: 'medium'
            }
          }
        }
      }
    },
    getSpecTags: () => ['miner']
  }

  const thing = {
    type: 'miner',
    last: { snap: { success: true } },
    info: { test: 'info' },
    id: 'test-id'
  }

  const result = processThingAlerts.call(mockWorker, thing)

  t.ok(Array.isArray(result))
  t.is(result.length, 1)
  t.is(result[0].name, 'Test Alert')
  t.is(result[0].code, 'TEST_ALERT')
  t.is(result[0].description, 'Test alert description')
  t.is(result[0].severity, 'medium')
})

test('wrk-fun-alerts: processThingAlerts with spec validation error', async t => {
  const mockWorker = {
    loadLib: () => ({
      specs: {
        miner: {
          test_alert: {
            valid: () => { throw new Error('Validation error') },
            probe: () => null
          }
        }
      }
    }),
    conf: {
      thing: {
        alerts: {
          miner: {}
        }
      }
    },
    getSpecTags: () => ['miner']
  }

  const thing = {
    type: 'miner',
    last: { snap: { success: true } },
    info: { test: 'info' },
    id: 'test-id'
  }

  const result = processThingAlerts.call(mockWorker, thing)

  t.ok(Array.isArray(result))
  t.is(result.length, 1)
  t.is(result[0].name, 'test_alert')
  t.is(result[0].code, 'test_alert')
  t.is(result[0].description, 'Validation error')
  t.is(result[0].severity, 'medium')
})

test('wrk-fun-alerts: processThingAlerts returns null when no alerts', async t => {
  const mockWorker = {
    loadLib: () => ({ specs: {} }),
    conf: {
      thing: {
        alerts: {
          miner: {}
        }
      }
    },
    getSpecTags: () => []
  }

  const thing = {
    type: 'miner',
    last: { snap: { success: true } }
  }

  const result = processThingAlerts.call(mockWorker, thing)
  t.is(result, null)
})

test('wrk-fun-alerts: error_snap reuses uuid from previous alerts', async t => {
  const prevUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const mockWorker = {
    loadLib: () => ({ specs: {} }),
    conf: { thing: { alerts: { miner: {} } } },
    getSpecTags: () => []
  }
  const thing = {
    type: 'miner',
    last: {
      err: 'No snap',
      alerts: [{
        name: 'error_snap',
        description: 'No snap',
        message: undefined,
        createdAt: 4242,
        uuid: prevUuid
      }]
    }
  }
  const result = processThingAlerts.call(mockWorker, thing)
  t.is(result[0].uuid, prevUuid)
  t.is(result[0].createdAt, 4242)
})

test('wrk-fun-alerts: ignores spec tags without specs entry', async t => {
  const mockWorker = {
    loadLib: () => ({
      specs: {
        miner: {
          a: { valid: () => true, probe: () => ({}) }
        }
      }
    }),
    conf: {
      thing: {
        alerts: {
          miner: { a: { name: 'A', code: 'A', description: 'd', severity: 'low' } }
        }
      }
    },
    getSpecTags: () => ['other', 'miner']
  }
  const thing = {
    type: 'miner',
    last: { snap: { success: true } },
    info: {},
    id: 'id1'
  }
  const result = processThingAlerts.call(mockWorker, thing)
  t.ok(Array.isArray(result))
  t.ok(result.length >= 1)
})

test('wrk-fun-alerts: valid false skips probe', async t => {
  const mockWorker = {
    loadLib: () => ({
      specs: {
        miner: {
          quiet: {
            valid: () => false,
            probe: () => {
              throw new Error('probe must not run')
            }
          }
        }
      }
    }),
    conf: {
      thing: {
        alerts: {
          miner: { quiet: { name: 'Q', code: 'Q', description: 'd', severity: 'low' } }
        }
      }
    },
    getSpecTags: () => ['miner']
  }
  const thing = {
    type: 'miner',
    last: { snap: { success: true } },
    info: {},
    id: 'id1'
  }
  const result = processThingAlerts.call(mockWorker, thing)
  t.is(result, null)
})

test('wrk-fun-alerts: array probe result raises one alert per match with message', async t => {
  const mockWorker = {
    loadLib: () => ({
      specs: {
        miner: {
          tag_warning: {
            valid: () => true,
            probe: () => ['TAG-A', 'TAG-B']
          }
        }
      }
    }),
    conf: {
      thing: {
        alerts: {
          miner: {
            tag_warning: { description: 'Tag warning', severity: 'warning' }
          }
        }
      }
    },
    getSpecTags: () => ['miner']
  }
  const thing = {
    type: 'miner',
    last: { snap: { success: true } },
    info: {},
    id: 'id1'
  }
  const result = processThingAlerts.call(mockWorker, thing)

  t.ok(Array.isArray(result))
  t.is(result.length, 2, 'one alert per breaching tag')
  t.alike(result.map(a => a.message), ['TAG-A', 'TAG-B'], 'device tag carried in message')
  t.ok(result.every(a => a.name === 'tag_warning' && a.severity === 'warning' && a.description === 'Tag warning'))
})

test('wrk-fun-alerts: empty array probe result raises no alert', async t => {
  const mockWorker = {
    loadLib: () => ({
      specs: {
        miner: {
          tag_warning: {
            valid: () => true,
            probe: () => []
          }
        }
      }
    }),
    conf: {
      thing: {
        alerts: {
          miner: { tag_warning: { description: 'Tag warning', severity: 'warning' } }
        }
      }
    },
    getSpecTags: () => ['miner']
  }
  const thing = {
    type: 'miner',
    last: { snap: { success: true } },
    info: {},
    id: 'id1'
  }
  const result = processThingAlerts.call(mockWorker, thing)
  t.is(result, null, 'empty array means no breach')
})

test('wrk-fun-alerts: object match supports per-alert description override', async t => {
  const mockWorker = {
    loadLib: () => ({
      specs: {
        miner: {
          tag_warning: {
            valid: () => true,
            probe: () => [
              { message: 'TAG-A', description: 'detailed A' },
              { message: 'TAG-B' }
            ]
          }
        }
      }
    }),
    conf: {
      thing: {
        alerts: {
          miner: { tag_warning: { description: 'base description', severity: 'warning' } }
        }
      }
    },
    getSpecTags: () => ['miner']
  }
  const thing = {
    type: 'miner',
    last: { snap: { success: true } },
    info: {},
    id: 'id1'
  }
  const result = processThingAlerts.call(mockWorker, thing)

  t.is(result.length, 2)
  t.is(result[0].message, 'TAG-A')
  t.is(result[0].description, 'detailed A', 'per-match description used when provided')
  t.is(result[1].message, 'TAG-B')
  t.is(result[1].description, 'base description', 'falls back to config description')
})

test('wrk-fun-alerts: createdAt/uuid persist when only the description (reading) changes', async t => {
  const prevUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const mockWorker = {
    loadLib: () => ({
      specs: {
        miner: {
          tag_warning: {
            valid: () => true,
            // Same tag, but the reading embedded in description has changed.
            probe: () => [{ message: 'TAG-A', description: 'reading 321 (threshold 330)' }]
          }
        }
      }
    }),
    conf: {
      thing: {
        alerts: {
          miner: { tag_warning: { description: 'base', severity: 'warning' } }
        }
      }
    },
    getSpecTags: () => ['miner']
  }
  const thing = {
    type: 'miner',
    last: {
      snap: { success: true },
      alerts: [{
        name: 'tag_warning',
        message: 'TAG-A',
        description: 'reading 305 (threshold 330)', // older reading
        createdAt: 4242,
        uuid: prevUuid
      }]
    },
    info: {},
    id: 'id1'
  }
  const result = processThingAlerts.call(mockWorker, thing)

  t.is(result.length, 1)
  t.is(result[0].description, 'reading 321 (threshold 330)', 'description reflects the new reading')
  t.is(result[0].createdAt, 4242, 'createdAt pinned to when the condition first appeared')
  t.is(result[0].uuid, prevUuid, 'uuid preserved across the changing reading')
})
