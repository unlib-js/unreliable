import assert from 'assert'
import { Disposable, on } from './disposable-events'
import EventEmitter, { once } from 'events'
import { StartFailureReason, StateChange, StopReason, UnreliableDeathError, UnreliableMeta } from './Unreliable.h'
import EventBarrier from '@unlib-js/event-barrier'


export function getMeta<U extends EventEmitter>(inst: Unreliable<U>): UnreliableMeta {
  return (inst.constructor as typeof Unreliable).meta
}

export interface Unreliable<U extends EventEmitter> extends EventBarrier {
  notify<C extends StateChange>(state: string, change: C, count?: number): this
  notify(state: string, value?: any, count?: number): this
  waitFor<C extends StateChange>(state: string, timeout?: number, signal?: AbortSignal): Promise<C>
  waitFor<T>(event: string, timeout?: number, signal?: AbortSignal): Promise<T>
  on<C extends StateChange>(state: string, callback: (change: C) => void): this
  on(event: string, callback: (...args: any[]) => void): this
  once<C extends StateChange>(state: string, callback: (change: C) => void): this
  once(event: string, callback: (...args: any[]) => void): this
  off<C extends StateChange>(state: string, callback: (change: C) => void): this
  off(event: string, callback: (...args: any[]) => void): this
}

/**
 * An unreliable is a wrapper for unreliable things, e.g., a different process, a VM, etc.
 * 
 * **"Unreliable" means it could stop working at any moment**
 * 
 * This class provides basic framework for implementation.
 * There are 6 basic states:
 * 
 * 1. Init: this object is just created in memory, nothing more than that
 * 2. Starting: the underlying object is starting
 * 3. Start failed: the underlying object failed to start
 * 4. Running: the underlying object is running/idle and in good health
 * 5. Stopping: the underlying object is stopping
 * 6. Stopped: the underlying object has stopped (for whatever reason)
 * 
 * These 4 basic states should be passed to this class by its sub-classes
 * in case they want to use customized state names.
 * 
 * States should be represented as strings.
 * 
 * Usage:
 * 
 * ```TypeScript
 * class Process extends Unreliable<ChildProcess> {
 *   // ...
 * }
 * ```
 */
export abstract class Unreliable<U extends EventEmitter> extends EventBarrier {
  /**
   * Sub-class must override this
   */
  static meta: UnreliableMeta
  _state: string = getMeta(this).states.init
  _setState<R extends Array<any>>(newState: string, extra: StopReason<R>): void
  _setState(newState: string, extra: StartFailureReason): void
  _setState(newState: string, extra?: object): void
  _setState(newState: string, extra: object = {}): void {
    this.notify(newState, { oldState: this._state, ...extra } as StateChange)
    this._state = newState
  }
  /**
   * Current state
   */
  public get state(): string {
    return this._state
  }

  /**
   * The underlying object, `null` means it is not yet created or dead
   */
  protected _uObj: U | null = null
  /**
   * Whether the object is okay to start
   */
  public get startable(): boolean {
    return this._meta.stateConf.startable.has(this._state)
  }
  /**
   * Whether we can stop the object
   */
  public get stoppable(): boolean {
    return this._meta.stateConf.stoppable.has(this._state)
  }

  protected get _meta(): UnreliableMeta {
    return getMeta(this)
  }

  /**
   * Things that we need to clean up on complete stop
   */
  protected _disposables: Disposable[] = []
  
  /**
   * Start the underlying object
   */
  public async start(): Promise<void> {
    try {
      await this._start()
    } catch (err) {
      const { _meta: { stateConf: { abortOnStartFailure }, states: { startFailed } } } = this
      for (const event of abortOnStartFailure) this.abort(event, err)
      this._setState(startFailed, { err } as StartFailureReason)
      throw err
    }
  }

  /**
   * Do start the underlying object
   * 
   * Any error thrown will cause the state to change to a "start failed" state
   * 
   * Subclasses should avoid overriding this method
   * 
   * @returns the underlying object
   */
  protected async _start(): Promise<U> {
    assert(this.startable, 'Not startable')
    assert(this._uObj === null, 'Invalid state')
    const { _meta: { states: { starting, running }, deathEvents, eventHandlers } } = this
    this._setState(starting)
    const obj = this._uObj = await this._createAndCheck()
    this._setState(running)
    const { _disposables: disposables } = this
    // Handle error
    disposables.push(on(obj, 'error', this._onError.bind(this)))
    // Handle death
    const onDeath = this._onDeath.bind(this)
    for (const deathEvent of deathEvents) {
      disposables.push(on(obj, deathEvent, onDeath))
    }
    // Register other events
    for (const event in eventHandlers) {
      const handlerName = eventHandlers[event]
      const handler = ((this as any)[handlerName] as () => void).bind(this)
      disposables.push(on(obj, event, handler))
    }
    return obj
  }

  /**
   * Create the underlying object and check if the creation is successful
   * 
   * The state will be set to "starting" before this call
   * and "running" after this call
   */
  protected async _createAndCheck(): Promise<U> {
    throw new Error('Not implemented by sub-class')
  }

  /**
   * Stop the underlying object (not necessarily immediately)
   */
  public stop() {
    assert(this.stoppable, `Cannot stop in state: ${this._state}`)
    assert(this._uObj !== null, 'Invalid state')
    this._setState(this._meta.states.stopping)
    this._stop()
  }

  /**
   * Do stop the underlying object
   */
  protected _stop() {
    throw new Error('Not implemented by sub-class')
  }

  /**
   * Do some `job` but cancel the job if the underlying object dies
   * 
   * If rejected, this method throws
   * 
   * 1. `UnreliableDeathError` when the underlying object stops before the `job` is settled, or
   * 2. Whatever errors that the underlying object throws before the `job` is settled, or
   * 3. Whatever the `job` throws before the underlying object dies (for whatever reason)
   * 
   * @param job the job to do; it must handle the abort signal;
   * on abort signal, it means the underlying object is dead for whatever reason,
   * and `abortOnDeath` has thrown an `UnreliableDeathError`
   * or whatever the underlying object has thrown
   * @returns whatever `job` returns
   */
  public async abortOnDeath<R>(job: (signal: AbortSignal) => Promise<R>): Promise<R> {
    const { _uObj: uObj } = this
    assert(uObj, 'The underlying object does not exist')
    const { _meta: { deathEvents, deathErrorClass = UnreliableDeathError } } = this
    const ac = new AbortController
    try {
      const jobs = [ job(ac.signal) ]
      for (const deathEvent of deathEvents) {
        jobs.push((async () => {
          const reason = await once(uObj, deathEvent, { signal: ac.signal })
          throw new deathErrorClass(uObj, reason)
        })())
      }
      return await Promise.race(jobs)
    } finally {
      ac.abort()
    }
  }

  /* Start event handling area */

  /**
   * Handle the `error` event from the underlying object
   * @param err
   */
  protected _onError(err: Error) {
    this.abortAll(err)
  }

  /* End event handling area */

  /**
   * The sub-class **may** call this method to explicitly notify
   * the death of the underlying object that happened **after** a successful start
   * 
   * This handler will dispose all disposables and set the state to "stopped"
   * @param reason death reason
   */
  protected _onDeath<R extends Array<any>>(...reason: R) {
    const { _meta: { states: { stopped }, stateConf: { abortOnDeath }, deathErrorClass = UnreliableDeathError } } = this
    const err = new deathErrorClass(this._uObj, reason)
    this._setState(stopped, { reason } as StopReason<R>)
    this._uObj = null
    for (const disposable of this._disposables) disposable.dispose()
    this._disposables.splice(0)
    for (const event of abortOnDeath) this.abort(event, err)
  }

  /**
   * Return immediately if the object is already in the specified state,
   * otherwise wait for the state to change to the desired one
   * @param dstState desired state
   * @param timeout timeout in milliseconds
   * @param signal an optional abort signal
   */
  public async waitForState<R extends StateChange = StateChange>(dstState: string, timeout?: number, signal?: AbortSignal): Promise<R | undefined> {
    if (this._state == dstState) return
    return super.waitFor<R>(dstState, timeout, signal)
  }
}

export default Unreliable

export * from './Unreliable.h'
