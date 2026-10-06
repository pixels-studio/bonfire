/**
 * The agent host: a utility process that runs the Claude SDK and the Codex connection. It
 * parses every streamed update away from the main process, so a runaway stream or a crashing
 * SDK can't freeze the window; main keeps the state and the saving, and is sent the result.
 */
import { startAgentWorker } from './agent-worker';
import { parentEndpoint } from './host-endpoint';
import { forwardConsole } from './rpc';

const { main } = startAgentWorker(parentEndpoint());
forwardConsole(main);
