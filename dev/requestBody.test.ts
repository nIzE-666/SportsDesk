import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { expect, it } from 'vitest';
import { readJsonBody } from './requestBody';
it('accepts a season-history batch larger than 64 KiB', async () => {
  const input = new EventEmitter();
  const promise = readJsonBody(input as IncomingMessage);
  const text = JSON.stringify({
    command: 'history_upsert',
    args: {
      matches: Array.from({ length: 380 }, (_, id) => ({
        id,
        homeName: 'Arsenal',
        awayName: 'Chelsea',
        details: 'x'.repeat(200),
      })),
    },
  });
  input.emit('data', Buffer.from(text));
  input.emit('end');
  expect((await promise).command).toBe('history_upsert');
});
it('rejects oversized or malformed requests without destroying the server connection', async () => {
  const input = new EventEmitter();
  const promise = readJsonBody(input as IncomingMessage, 8);
  const assertion = expect(promise).rejects.toMatchObject({ status: 413 });
  input.emit('data', Buffer.from('x'.repeat(9)));
  input.emit('data', Buffer.from('more'));
  input.emit('end');
  await assertion;
  const next = new EventEmitter();
  const second = readJsonBody(next as IncomingMessage);
  const invalid = expect(second).rejects.toMatchObject({ status: 400 });
  next.emit('data', Buffer.from('{oops'));
  next.emit('end');
  await invalid;
});
