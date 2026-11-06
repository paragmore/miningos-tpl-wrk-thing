const test = require('brittle')
const { promiseSleep } = require('@bitfinex/lib-js-util-promise')
const path = require('path')
const { getTests, validateJSON, shouldRunTest } = require(path.join(process.cwd(), 'tests/utils'))
const yargs = require('yargs')
const { hideBin } = require('yargs/helpers')

const argv = yargs(hideBin(process.argv))
  .option('live', {
    alias: 'l',
    type: 'boolean',
    description: 'live mode',
    default: false
  })
  .option('host', {
    alias: 'h',
    type: 'string',
    description: 'host to run on',
    default: '127.0.0.1'
  })
  .option('interactive', {
    alias: 'i',
    type: 'boolean',
    description: 'interactive mode',
    default: false
  })
  .option('port', {
    alias: 'p',
    type: 'number',
    description: 'port to run on',
    default: 48080
  })
  .option('username', {
    alias: 'u',
    type: 'string',
    description: 'username',
    default: 'root'
  })
  .option('password', {
    alias: 'a',
    type: 'string',
    description: 'password',
    default: 'root'
  })
  .option('timeout', {
    alias: 't',
    type: 'number',
    description: 'timeout',
    default: 2
  })
  .option('noOfRetries', {
    alias: 'n',
    type: 'number',
    description: 'no of retries',
    default: 15
  })
  .parseSync()

function getDefaultConf () {
  const config = {
    tests: {},
    settings: {
      host: argv.host,
      port: argv.port,
      username: argv.username,
      password: argv.password,
      timeout: argv.timeout,
      retries: argv.noOfRetries,
      interactive: argv.interactive,
      live: argv.live
    }
  }

  // read tests
  Object.assign(config.tests, getTests())
  return config
}

test.configure({
  timeout: 100000
})

function cleanup (conf) {
  conf.cleanup()
  process.stdin.destroy()
  process.stdout.destroy()
}

async function testExecutor (dev, conf) {
  for (const testName in conf.tests) {
    // check if test should run
    if (conf.settings.interactive && !await shouldRunTest(`test ${testName}`)) continue
    const _test = conf.tests[testName]

    // preTestHook
    if (_test.preTestHook) {
      await _test.preTestHook({ dev, conf })
    }

    await test(`test ${testName}`, async (t) => {
      // preStageHook
      if (_test.preStageHook) {
        await _test.preStageHook({ dev, conf, t })
      }

      // stages
      for (const stage of _test.stages) {
        // check if stage should run
        if (conf.settings.interactive && stage.ask && !await shouldRunTest(`test ${testName} (${stage.name})`)) continue

        await t.test(stage.name, async (t) => {
          // get validate field
          const validate = stage.validate
          // wait if needed
          if (stage.wait) await promiseSleep(stage.wait)
          // validate
          switch (validate.type) {
            case 'exception':
              await t.exception(async () => await stage.executor({ dev, conf, t }), validate.message)
              break
            case 'schema':
              validateJSON(t, await stage.executor({ dev, conf, t }), validate.schema)
              break
            case 'function':
              await validate.func({ dev, conf, t }, await stage.executor({ dev, conf, t }))
              break

            default:
              await stage.executor({ dev, conf, t })
              break
          }
        })
      }

      // postStageHook
      if (_test.postStageHook) {
        await _test.postStageHook({ dev, conf, t })
      }
    })

    // postTestHook
    if (_test.postTestHook) {
      await _test.postTestHook({ dev, conf })
    }
  }

  cleanup(conf)
}

module.exports = {
  testExecutor,
  getDefaultConf
}
