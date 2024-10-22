import EventEmitter from 'events'
import { setTimeout as sleep } from 'timers/promises'
import { describe, expect, it } from 'vitest'
import Daemon, { DaemonEvents, DaemonStatus, StartFailureError } from './Daemon'
import Unreliable from './Unreliable'
import { UnreliableMeta } from './Unreliable.h'


class FakeProcess extends Unreliable<EventEmitter> {
  public static override readonly meta: UnreliableMeta = {
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

describe('Daemon', { sequential: true, timeout: 60_000 }, () => {
  const fake = new FakeProcess()
  function dieIn(sec: number) {
    fake.life = sec * 1000
  }
  const daemon = new Daemon(fake, { maxAttempt: 3, retryDelay: 2000 })
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

  it('should restart the unreliable that keeps dying until max attempts reached', async () => {
    dieIn(0)
    daemon.start()
    for (let i = 1; i <= daemon.maxAttempt; i++) {
      const err: StartFailureError = await daemon.waitFor(DaemonEvents.START_FAILED, 6000)
      expect(err.nthAttempt).toBe(i)
      console.debug('Attempt', err.nthAttempt, 'failed as expected')
      const nextAttempt = i + 1
      if (nextAttempt <= daemon.maxAttempt) {
        console.debug('Next attempt is', nextAttempt)
        // `DaemonEvents.RETRY_SCHEDULED` already emitted with `DaemonEvents.START_FAILED`
        expect(daemon.state).toBe(DaemonStatus.RETRY_SCHEDULED)
        // Somehow, `await expect(...).resolves.toBe(...)` adds significant delay here
        expect(await daemon.waitFor(DaemonEvents.STARTING, daemon.retryDelay + 500)).toBe(nextAttempt)
        expect(daemon.state).toBe(DaemonStatus.STARTING)
      } else {
        console.debug('Max attempts reached')
        expect(err.retryIn).toBe(-1)
        expect(daemon.dead).toBe(true)
      }
    }
  })

  it('should complete the running-restart-and-stop lifecycle correctly', async () => {
    dieIn(7)
    daemon.start()
    await daemon.waitFor(DaemonEvents.RUNNING, 6000)
    expect(daemon.state).toBe(DaemonStatus.RUNNING)
    await daemon.waitFor(DaemonEvents.RETRY_SCHEDULED, 3000)
    expect(daemon.state).toBe(DaemonStatus.RETRY_SCHEDULED)
    await expect(daemon.waitFor(DaemonEvents.STARTING, daemon.retryDelay + 500), 'Daemon did not restart the unreliable in time').resolves.toBeTruthy()
    expect(daemon.state).toBe(DaemonStatus.STARTING)
    await daemon.waitFor(DaemonEvents.RUNNING, 6000)
    expect(daemon.state).toBe(DaemonStatus.RUNNING)
    console.log('[Daemon] Stopping daemon')
    daemon.stop()
    await expect(daemon.waitFor(DaemonEvents.RETRY_SCHEDULED, 3000)).rejects.toThrow()
    expect(daemon.dead).toBe(true)
  })

  it('should complete the running-keep-dying-and-stop lifecycle correctly', async () => {
    dieIn(7)
    daemon.start()
    await daemon.waitFor(DaemonEvents.RUNNING, 6000)
    expect(daemon.state).toBe(DaemonStatus.RUNNING)
    await daemon.waitFor(DaemonEvents.RETRY_SCHEDULED, 3000)
    expect(daemon.state).toBe(DaemonStatus.RETRY_SCHEDULED)
    dieIn(0)
    for (let i = 0; i < daemon.maxAttempt; i++) {
      await daemon.waitFor(DaemonEvents.START_FAILED, 6000 + daemon.retryDelay + 500)
      expect(daemon.state).toBe(i < daemon.maxAttempt - 1 ? DaemonStatus.RETRY_SCHEDULED : DaemonStatus.DEAD)
    }
    expect(daemon.dead).toBe(true)
  })
})
