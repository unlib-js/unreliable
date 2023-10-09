export interface StateChange<T = string> {
  oldState: T
}

export interface StartFailureReason {
  err: any
}

export type ChangeToStarting = StateChange
export type ChangeToStartFailed = StateChange & StartFailureReason
export type ChangeToRunning = StateChange
export type ChangeToStopping = StateChange
export interface StopReason<R extends Array<any>> {
  reason: R
}
export type ChangeToStopped = StateChange & StopReason<any[]>

export interface UnreliableMeta {
  states: {
    init: string
    starting: string
    startFailed: string
    running: string
    stopping: string
    stopped: string
  }
  stateConf: {
    startable: Set<string>
    stoppable: Set<string>
    abortOnStartFailure: Iterable<string>
    abortOnDeath: Iterable<string>
  }
  eventHandlers: { [key: string]: string }
  deathEvents: Iterable<string>
  deathErrorClass?: typeof UnreliableDeathError
}

export class UnreliableDeathError<U, R> extends Error {
  public override name = 'UnreliableDeathError'
  public readonly unreliable: U
  public readonly reason: R
  constructor(unreliable: U, reason: R, msg?: string) {
    super(msg)
    this.unreliable = unreliable
    this.reason = reason
  }
}
