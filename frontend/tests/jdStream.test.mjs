import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJDDraft, readJDStream } from '../src/utils/jdStream.ts';

const draft = { description: '- 负责产品开发与跨团队协作', requirements: '- 熟悉 React 与 TypeScript' };
const event = (data, newline = '\n') => `data: ${JSON.stringify(data)}${newline}${newline}`;
const bytes = (text) => new TextEncoder().encode(text);
function response(chunks, onCancel = () => {}) {
  return new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
    cancel: onCancel,
  }));
}

for (const newline of ['\n', '\r\n']) {
  for (const size of [1, 2, 7, 100000]) {
    test(`reads complete Chinese SSE frames split every ${size} bytes (${JSON.stringify(newline)})`, async () => {
      const text = ': heartbeat' + newline + newline + event({ content: JSON.stringify(draft) }, newline) + event({ done: true, ...draft }, newline);
      const encoded = bytes(text);
      const chunks = [];
      for (let start = 0; start < encoded.length; start += size) chunks.push(encoded.slice(start, start + size));
      assert.deepEqual(await readJDStream(response(chunks)), draft);
    });
  }
}

test('accepts done-only legacy protocol with a final unterminated event', async () => {
  assert.deepEqual(await readJDStream(response([bytes(event({ content: JSON.stringify(draft) }) + 'data:{"done":true}')])), draft);
});

test('accepts multiple data lines in one SSE event', async () => {
  const text = `data: {"done":true,\ndata: "description":${JSON.stringify(draft.description)},\ndata: "requirements":${JSON.stringify(draft.requirements)}}\n\n`;
  assert.deepEqual(await readJDStream(response([bytes(text)])), draft);
});

test('does not treat an interrupted stream as successful even if partial content is valid JSON', async () => {
  await assert.rejects(readJDStream(response([bytes(event({ content: JSON.stringify(draft) }))])), /响应中断/);
});

test('propagates server errors without showing a false result', async () => {
  await assert.rejects(readJDStream(response([bytes(event({ content: 'partial' }) + event({ error: '输出被截断' }))])), /输出被截断/);
});

test('rejects malformed complete events rather than silently ignoring them', async () => {
  await assert.rejects(readJDStream(response([bytes('data: {invalid}\n\n')])), /格式异常/);
});

for (const invalid of [null, [], {}, { ...draft, description: '' }, { ...draft, requirements: ['React'] }, { ...draft, description: 'x'.repeat(2001) }]) {
  test(`rejects an invalid draft ${JSON.stringify(invalid).slice(0, 80)}`, () => {
    assert.throws(() => parseJDDraft(invalid));
  });
}

test('validates the final server result before returning it', async () => {
  await assert.rejects(readJDStream(response([bytes(event({ done: true, description: '', requirements: '' }))])), /为空/);
});

test('cancels the reader after completion instead of waiting indefinitely for EOF', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(bytes(event({ done: true, ...draft }))); },
    cancel() { cancelled = true; },
  });
  assert.deepEqual(await readJDStream(new Response(body)), draft);
  assert.equal(cancelled, true);
});
