import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACK_TIMEOUT_MS,
  HIGH_WATER_CHARS,
  LOW_WATER_CHARS,
  OutputFlow,
} from '../electron/main/terminal-flow';

function program() {
  const calls: string[] = [];
  return {
    calls,
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
  };
}

test('a terminal nobody has acknowledged runs freely', () => {
  const pty = program();
  const flow = new OutputFlow(pty);
  flow.sent(HIGH_WATER_CHARS * 4);
  assert.deepEqual(pty.calls, []);
  flow.close();
});

test('a program is paused while the window is behind and resumed once it catches up', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pty = program();
  const flow = new OutputFlow(pty);
  flow.acked(0);
  flow.sent(HIGH_WATER_CHARS);
  assert.deepEqual(pty.calls, []);
  flow.sent(1);
  assert.deepEqual(pty.calls, ['pause']);
  // More output already read while pausing doesn't pause again.
  flow.sent(1000);
  assert.deepEqual(pty.calls, ['pause']);
  // Catching up part of the way keeps it paused, and keeps it from timing out.
  flow.acked(HIGH_WATER_CHARS - LOW_WATER_CHARS);
  t.mock.timers.tick(ACK_TIMEOUT_MS - 1);
  assert.equal(flow.isPaused, true);
  flow.acked(1001 + 1);
  assert.deepEqual(pty.calls, ['pause', 'resume']);
  flow.close();
});

test('a window that stops answering lets the program go, until it answers again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pty = program();
  const flow = new OutputFlow(pty);
  flow.acked(0);
  flow.sent(HIGH_WATER_CHARS + 1);
  t.mock.timers.tick(ACK_TIMEOUT_MS);
  assert.deepEqual(pty.calls, ['pause', 'resume']);
  // Unwatched now, so a flood runs on.
  flow.sent(HIGH_WATER_CHARS * 2);
  assert.deepEqual(pty.calls, ['pause', 'resume']);
  flow.close();
});

test('a new view counts from its snapshot', () => {
  const pty = program();
  const flow = new OutputFlow(pty);
  flow.acked(0);
  flow.sent(HIGH_WATER_CHARS + 1);
  flow.restart();
  assert.deepEqual(pty.calls, ['pause', 'resume']);
  flow.acked(0);
  flow.sent(HIGH_WATER_CHARS);
  assert.deepEqual(pty.calls, ['pause', 'resume']);
  flow.close();
});
