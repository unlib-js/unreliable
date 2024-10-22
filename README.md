# `Unreliable`

Management wrapper for unreliable resources, e.g., another process.

## Example

```TypeScript
import { ChildProcess, spawn } from 'child_process'
import Unreliable from '@unlib-js/unreliable'
import stopOnExit from '@unlib-js/unreliable/stopOnExit'
import { once } from 'events'


class Proc extends Unreliable<ChildProcess> {
  static meta: UnreliableMeta = {
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

  public async start() {
    await super.start()
    stopOnExit(this)
  }

  protected async _createAndCheck() {
    const proc = spawn('foo', [ 'bar' ])
    try {
      await once(proc, 'spawn')
    } catch (err) {
      proc.kill()
      throw err
    }
    return proc
  }

  protected _stop() {
    this._uObj!.kill()
  }
}


async function foo() {
  const proc = new Proc
  await proc.start()
  // Do something with `proc`
  proc.stop()
  await proc.waitForState('stopped')
}
```

For example of unreliable daemon, see `src/Daemon.test.ts`.
