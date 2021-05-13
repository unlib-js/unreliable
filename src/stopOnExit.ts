import EventEmitter from 'events'
import Unreliable, { getMeta } from './Unreliable'


/**
 * Stop the unreliable before process exits and complain about the unreliable leak
 * @param unreliable the unreliable object
 * @param timeout wait for `timeout` ms for the unreliable to stop before we give up
 */
export function stopOnExit<U extends EventEmitter>(unreliable: Unreliable<U>, timeout: number = 5000) {
  const { states: { stopped } } = getMeta(unreliable)
  /* Process exits normally, we can continue the process */
  const easyCleanUp = async () => {
    if (unreliable.stoppable) {
      console.warn(`An instance of [class ${unreliable.constructor.name}] is not stopped on exit, trying to stop it gracefully:`, unreliable)
      try {
        unreliable.stop()
        await unreliable.waitForState(stopped, timeout)
        console.log(`Stopped unreliable of [class ${unreliable.constructor.name}]`)
      } catch (err) {
        console.error('Cannot stop unreliable:', unreliable, err)
      }
    }
  }
  /* Process exits because of uncaught exception/rejection, it will exit in no time */
  const urgentCleanUp = () => {
    if (unreliable.stoppable) {
      console.warn(`An instance of [class ${unreliable.constructor.name}] is not stopped on exit, trying my best to stop it (may fail):`, unreliable)
      try {
        unreliable.stop()
      } catch (err) {
        console.error('Cannot stop unreliable:', unreliable, err)
      }
    }
  }
  unreliable.once(
    stopped,
    () => process
      .off('beforeExit', easyCleanUp)
      .off('exit', urgentCleanUp)
  )
  process
    .once('beforeExit', easyCleanUp)
    .once('exit', urgentCleanUp)
}

export default stopOnExit
