import Daemon, { DaemonEvents, DaemonStatus, StartFailureError } from './Daemon'
import assert from 'assert'
import Unreliable from './Unreliable'
import EventEmitter from 'events'
import { UnreliableMeta } from './Unreliable.h'
import { setTimeout as sleep } from 'timers/promises'


class FakeProcess extends Unreliable<EventEmitter> {
  public static override meta: UnreliableMeta = {
    states: {
      init: 'init',
      starting: 'starting',
      startFailed: 'start-failed',
      running: 'running',
      stopping: 'stopping',
      stopped: 'stopped'
    },
    stateConf: {
      startable: new Set([ 'init', 'start-failed', 'stopped' ]),
      stoppable: new Set([ 'running', 'stopping' ]),
      abortOnDeath: [ 'starting', 'running' ],
      abortOnStartFailure: [ 'running', 'stopped' ]
    },
    eventHandlers: {},
    deathEvents: [ 'exit' ]
  }
  public get it() {
    return this._uObj
  }

  public life: number = 0

  protected override async _createAndCheck() {
    const { life } = this
    if (life < 5000) throw new Error
    const it = new EventEmitter
    setTimeout(() => it.emit('exit'), life)
    await sleep(5000)
    return it
  }

  protected override _stop() {
    this.it!.emit('exit')
  }
}

async function main() {
  const fake = new FakeProcess
  function dieIn(sec: number) {
    fake.life = sec * 1000
  }

  const daemon = new Daemon(fake, { maxAttempt: 3, retryDelay: 3000 })
  daemon
    .on(DaemonEvents.STARTING, nthAttempt => console.log('[Daemon] Starting process, attempt:', nthAttempt, 'out of', daemon.maxAttempt))
    .on(DaemonEvents.RUNNING, () => console.log('[Daemon] Process running'))
    .on(DaemonEvents.START_FAILED, err => {
      console.log('[Daemon] Failed to start process in attempt', err.nthAttempt)
      if (err.retryIn == -1) {
        console.log('[Daemon] Too many failed attempts, giving up')
      }
    })
    .on(DaemonEvents.RETRY_SCHEDULED, ({ nthAttempt, retryDelay }) => console.log('[Daemon] Process stopped, scheduling attempt', nthAttempt, 'in', retryDelay / 1000, 'second(s)'))

  dieIn(0)
  daemon.start()
  for (let i = 0; i < daemon.maxAttempt; i++) {
    let err: StartFailureError
    const prom = async () => {
      err = await daemon.waitFor(DaemonEvents.START_FAILED, 6000)
    }
    await assert.doesNotReject(prom)
    if (i < daemon.maxAttempt - 1) {
      // `DaemonEvents.RETRY_SCHEDULED` already emitted with `DaemonEvents.START_FAILED`
      assert.strictEqual(daemon.state, DaemonStatus.RETRY_SCHEDULED)
      await assert.doesNotReject(daemon.waitFor(DaemonEvents.STARTING, daemon.retryDelay + 500), 'Daemon did not restart the unreliable in time')
      assert.strictEqual(daemon.state, DaemonStatus.STARTING)
    } else {
      assert.strictEqual(err!.retryIn, -1)
      assert(daemon.dead)
    }
  }
  console.log('Daemon keep-dying: passed')

  dieIn(7)
  daemon.start()
  await assert.doesNotReject(daemon.waitFor(DaemonEvents.RUNNING, 6000))
  assert.strictEqual(daemon.state, DaemonStatus.RUNNING)
  await assert.doesNotReject(daemon.waitFor(DaemonEvents.RETRY_SCHEDULED, 3000))
  assert.strictEqual(daemon.state, DaemonStatus.RETRY_SCHEDULED)
  await assert.doesNotReject(daemon.waitFor(DaemonEvents.STARTING, daemon.retryDelay + 500), 'Daemon did not restart the unreliable in time')
  assert.strictEqual(daemon.state, DaemonStatus.STARTING)
  await assert.doesNotReject(daemon.waitFor(DaemonEvents.RUNNING, 6000))
  assert.strictEqual(daemon.state, DaemonStatus.RUNNING)
  console.log('[Daemon] Stopping daemon')
  daemon.stop()
  await assert.rejects(daemon.waitFor(DaemonEvents.RETRY_SCHEDULED, 3000))
  assert(daemon.dead)
  console.log('Daemon running-restart-and-stop: passed')

  dieIn(7)
  daemon.start()
  await assert.doesNotReject(daemon.waitFor(DaemonEvents.RUNNING, 6000))
  assert.strictEqual(daemon.state, DaemonStatus.RUNNING)
  await assert.doesNotReject(daemon.waitFor(DaemonEvents.RETRY_SCHEDULED, 3000))
  assert.strictEqual(daemon.state, DaemonStatus.RETRY_SCHEDULED)
  dieIn(0)
  for (let i = 0; i < daemon.maxAttempt; i++) {
    await daemon.waitFor(DaemonEvents.START_FAILED, 6000 + daemon.retryDelay + 500)
    assert.strictEqual(daemon.state, i < daemon.maxAttempt - 1 ? DaemonStatus.RETRY_SCHEDULED : DaemonStatus.DEAD)
  }
  assert(daemon.dead)
  console.log('Daemon running-then-keep-dying: passed')
}

main()
