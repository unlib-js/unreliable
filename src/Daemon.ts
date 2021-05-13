import { setTimeout, clearTimeout } from 'timers'
import EventBarrier from '@unlib-js/event-barrier'
import { Disposable, once } from './disposable-events'
import { DaemonOptions, DaemonEvents, StartFailureError, EventArgs, DaemonStatus } from './Daemon.h'
import Unreliable, { getMeta } from './Unreliable'


export interface Daemon<U extends Unreliable<any>> extends EventBarrier {
  notify(event: DaemonEvents.STARTING, arg: EventArgs.Starting, count?: number): this
  notify(event: DaemonEvents.START_FAILED, arg: EventArgs.StartFailed, count?: number): this
  notify(event: DaemonEvents.RUNNING, arg: EventArgs.Running, count?: number): this
  notify(event: DaemonEvents.RETRY_SCHEDULED, arg: EventArgs.RetryScheduled, count?: number): this
  notify(event: string, value: any, count?: number): this

  waitFor(event: DaemonEvents.STARTING, timeout?: number, signal?: AbortSignal): Promise<EventArgs.Starting>
  waitFor(event: DaemonEvents.START_FAILED, timeout?: number, signal?: AbortSignal): Promise<EventArgs.StartFailed>
  waitFor(event: DaemonEvents.RUNNING, timeout?: number, signal?: AbortSignal): Promise<EventArgs.Running>
  waitFor(event: DaemonEvents.RETRY_SCHEDULED, timeout?: number, signal?: AbortSignal): Promise<EventArgs.RetryScheduled>
  waitFor(event: string, timeout?: number, signal?: AbortSignal): Promise<any>

  on(event: DaemonEvents.STARTING, callback: (arg: EventArgs.Starting) => void): this
  on(event: DaemonEvents.START_FAILED, callback: (arg: EventArgs.StartFailed) => void): this
  on(event: DaemonEvents.RUNNING, callback: (arg: EventArgs.Running) => void): this
  on(event: DaemonEvents.RETRY_SCHEDULED, callback: (arg: EventArgs.RetryScheduled) => void): this
  on(event: string, callback: (...args: any[]) => any): this

  once(event: DaemonEvents.STARTING, callback: (arg: EventArgs.Starting) => void): this
  once(event: DaemonEvents.START_FAILED, callback: (arg: EventArgs.StartFailed) => void): this
  once(event: DaemonEvents.RUNNING, callback: (arg: EventArgs.Running) => void): this
  once(event: DaemonEvents.RETRY_SCHEDULED, callback: (arg: EventArgs.RetryScheduled) => void): this
  once(event: string, callback: (...args: any[]) => any): this

  off(event: DaemonEvents.STARTING, callback: (arg: EventArgs.Starting) => void): this
  off(event: DaemonEvents.START_FAILED, callback: (arg: EventArgs.StartFailed) => void): this
  off(event: DaemonEvents.RUNNING, callback: (arg: EventArgs.Running) => void): this
  off(event: DaemonEvents.RETRY_SCHEDULED, callback: (arg: EventArgs.RetryScheduled) => void): this
  off(event: string, callback: (...args: any[]) => any): this
}

/**
 * Daemon for unreliable objects
 */
export class Daemon<U extends Unreliable<any>> extends EventBarrier {
  public it: U
  /**
   * Maximum number of starting attempt when starting the VM
   */
  public maxAttempt: number
  /**
   * Delay in milliseconds before next attempt
   */
  public retryDelay: number

  protected _retryTimer: ReturnType<typeof setTimeout> | null = null

  protected _disposables: Disposable[] = []

  /**
   * Current daemon state
   */
  protected _state: DaemonStatus = DaemonStatus.INIT
  /**
   * Expose daemon status
   */
  public get state() {
    return this._state
  }

  /**
   * Shortcut of `daemon.state == DaemonStatus.RUNNING`
   */
  public get available() {
    return this._state == DaemonStatus.RUNNING
  }

  /**
   * If the daemon has given up or stopped
   */
  public get dead() {
    return this._state == DaemonStatus.DEAD
  }

  /**
   * @param it a just-initialized, not-yet-starting unreliable
   */
  constructor(it: U, { maxAttempt, retryDelay }: DaemonOptions) {
    super()
    this.it = it
    this.maxAttempt = maxAttempt
    this.retryDelay = retryDelay
  }

  /**
   * Start the unreliable
   */
  public start() {
    this._state = DaemonStatus.INIT
    this._start()  // Start asynchronously
    return this
  }

  /**
   * Start the unreliable, this method should not throw error
   */
  protected async _start(nthAttempt: number = 1) {
    if (this.dead) return  // This should not happen but just in case
    if (this._retryTimer) {
      // This should not happen normally unless the caller was calling `start`
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }
    const { maxAttempt, it } = this
    this._cleanUp()
    try {
      this.notify(DaemonEvents.STARTING, nthAttempt)
      this._state = DaemonStatus.STARTING
      await it.start()
      this.notify(DaemonEvents.RUNNING)
      this._state = DaemonStatus.RUNNING
    } catch (err) {
      // In case it is actually running
      if (it.stoppable) {
        try {
          it.stop()
        } catch {}
      }
      if (nthAttempt >= maxAttempt) {
        // Emit event and give up
        const startFailure = new StartFailureError(err, nthAttempt, -1)
        this.notify(DaemonEvents.START_FAILED, startFailure)
        this._state = DaemonStatus.DEAD
        this.abort(DaemonEvents.RUNNING, startFailure)
      } else if (!this.dead) {
        // Emit event and schedule retry
        this.notify(DaemonEvents.START_FAILED, new StartFailureError(err, nthAttempt, this.retryDelay))
        this._scheduleRetry(nthAttempt + 1)
      }
      return
    }
    this._disposables.push(once(
      it, getMeta(it).states.stopped,
      () => {
        this._cleanUp()
        if (!this.dead) this._scheduleRetry()
        // Else: this should not happen but just in case
      }
    ))
  }

  protected _scheduleRetry(nthAttempt: number = 1) {
    if (this._retryTimer) clearTimeout(this._retryTimer)  // This should not happen
    const { retryDelay } = this
    this.notify(DaemonEvents.RETRY_SCHEDULED, { nthAttempt, retryDelay } as EventArgs.RetryScheduled)
    this._state = DaemonStatus.RETRY_SCHEDULED
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null
      this._start(nthAttempt)
    }, retryDelay)
  }

  /**
   * Clean up disposables and retry timer of the daemon
   */
  protected _cleanUp() {
    for (const disposable of this._disposables) disposable.dispose()
    this._disposables.splice(0)
    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }
  }

  /**
   * Stop the daemon
   */
  public stop() {
    this._state = DaemonStatus.DEAD
    this._cleanUp()
    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }
    try {
      this.it.stop()
    } catch {}
    return this
  }

  /**
   * Wait for the death of current unreliable
   * @param timeout timeout for waiting
   * @param signal an optional abort signal
   * @returns the state change object or undefined
   */
  public async waitForDeath(timeout?: number, signal?: AbortSignal) {
    const { it } = this
    if (it.stoppable) {
      return it.waitForState(getMeta(it).states.stopped, timeout, signal)
    }
  }
}

export default Daemon

export * from './Daemon.h'
