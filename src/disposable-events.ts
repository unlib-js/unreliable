import EventEmitter from 'events'


export interface Disposable {
  dispose(): void
}

export function once(emitter: EventEmitter, event: string, handler: (...args: any[]) => void): Disposable {
  emitter.once(event, handler)
  return { dispose() { emitter.off(event, handler) } }
}

export function on(emitter: EventEmitter, event: string, handler: (...args: any[]) => void): Disposable {
  emitter.on(event, handler)
  return { dispose() { emitter.off(event, handler) } }
}
