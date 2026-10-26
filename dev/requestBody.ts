import type { IncomingMessage } from 'node:http';
export class RequestBodyError extends Error {
  constructor(
    message: string,
    public status: 400 | 413,
  ) {
    super(message);
  }
}
/** Bound memory and drain rejected input so the caller can return a JSON error. */
export function readJsonBody(
  req: IncomingMessage,
  maxBytes = 2 * 1024 * 1024,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let bytes = 0,
      failed = false;
    const chunks: Buffer[] = [];
    const fail = (error: Error) => {
      if (!failed) {
        failed = true;
        chunks.length = 0;
        reject(error);
      }
    };
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        fail(new RequestBodyError('Слишком большой запрос.', 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        resolve(parsed as Record<string, unknown>);
      } catch {
        fail(new RequestBodyError('Некорректный JSON.', 400));
      }
    });
    req.on('aborted', () => fail(new RequestBodyError('Запрос прерван.', 400)));
    req.on('error', () => fail(new RequestBodyError('Не удалось прочитать запрос.', 400)));
  });
}
