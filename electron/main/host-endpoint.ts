import type { MessagePortMain } from 'electron';
import type { Endpoint } from './rpc';

/**
 * A utility process's side of its channel to main. A message that hands over a port, such
 * as one to the window, goes to `onPort` rather than to the channel.
 */
export function parentEndpoint(
  onPort?: (message: unknown, port: MessagePortMain) => void,
): Endpoint {
  const parent = process.parentPort;
  return {
    post: (message) => parent.postMessage(message),
    listen: (receive) =>
      parent.on('message', ({ data, ports }) => {
        if (ports.length && onPort) onPort(data, ports[0]);
        else receive(data);
      }),
  };
}

/** A port's side of a channel, as to the window. */
export function portEndpoint(port: MessagePortMain): Endpoint {
  return {
    post: (message) => port.postMessage(message),
    listen: (receive) => {
      port.on('message', ({ data }) => receive(data));
      port.start();
    },
  };
}
