export enum DaemonEvents {
  /**
   * When starting/restarting the unreliable
   */
  STARTING = 'starting',
  /**
   * When failed to start/restart the unreliable
   */
  START_FAILED = 'start-failed',
  /**
   * When the unreliable is successfully running
   */
  RUNNING = 'running',
  /**
   * A retry attempt is scheduled, this is emitted in the same tick with `START_FAILED`
   */
  RETRY_SCHEDULED = 'retry-scheduled'
}

export enum DaemonStatus {
  /**
   * 1. Just created, before first `STARTING` event, or
   * 2. Just called `start` (again)
   */
  INIT = 'init',
  /**
   * The daemon is starting/restarting the unreliable, after `STARTING` event
   */
  STARTING = 'starting',
  /**
   * The unreliable is successfully running and available, after `RUNNING` event
   */
  RUNNING = 'running',
  /**
   * A retry attempt is scheduled, after `RETRY_SCHEDULED` event
   */
  RETRY_SCHEDULED = 'retry-scheduled',
  /**
   * The daemon has given up or stopped, and will not try bringing back the unreliable again
   */
  DEAD = 'dead'
}

export interface DaemonOptions {
  /**
   * Maximum number of starting attempt when starting the unreliable
   */
  maxAttempt: number
  /**
   * Delay in milliseconds before next attempt
   */
  retryDelay: number
}

export class StartFailureError extends Error {
  name = 'StartFailureError'
  public readonly cause: any
  public readonly nthAttempt: number
  public readonly retryIn: number
  constructor(cause: any, nthAttempt: number, retryIn: number, msg?: string) {
    super(msg)
    this.cause = cause
    this.nthAttempt = nthAttempt
    this.retryIn = retryIn
  }
}

export namespace EventArgs {
  export type Starting = number
  export type StartFailed = StartFailureError
  export type Running = void
  export interface RetryScheduled {
    nthAttempt: number
    retryDelay: number
  }
}
