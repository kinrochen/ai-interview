export interface JDDraft {
  description: string;
  requirements: string;
}

export const JD_TEXT_LIMIT = 2000;

export function parseJDDraft(value: unknown): JDDraft {
  if (!value || typeof value !== 'object') {
    throw new Error('AI 返回的内容格式不正确，请重新生成');
  }
  const draft = value as Record<string, unknown>;
  for (const [key, label] of [['description', '岗位职责'], ['requirements', '任职要求']]) {
    const content = draft[key];
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error(`AI 返回的${label}为空或格式不正确，请重新生成`);
    }
    if (content.trim().length > JD_TEXT_LIMIT) {
      throw new Error(`${label}超过 ${JD_TEXT_LIMIT} 字，请精简后重试`);
    }
  }
  return {
    description: (draft.description as string).trim(),
    requirements: (draft.requirements as string).trim(),
  };
}

/** SSE frames and UTF-8 characters can span any number of network reads. */
export async function readJDStream(
  response: Response,
  onProgress?: (received: number) => void,
): Promise<JDDraft> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取 AI 响应，请重试');
  const decoder = new TextDecoder();
  let buffer = '';
  let eventLines: string[] = [];
  let content = '';
  let result: JDDraft | undefined;

  function dispatch() {
    if (!eventLines.length) return;
    const data = eventLines.join('\n');
    eventLines = [];
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error('AI 响应格式异常，请重新生成');
    }
    if (!event || typeof event !== 'object') throw new Error('AI 响应格式异常，请重新生成');
    if (typeof event.error === 'string') throw new Error(event.error);
    if (typeof event.content === 'string') {
      content += event.content;
      onProgress?.(content.length);
    }
    if (event.done === true) {
      // Accept the old done-only protocol as well as the validated server result.
      let draft: unknown = event;
      if (!('description' in event) && !('requirements' in event)) {
        try {
          draft = JSON.parse(content);
        } catch {
          throw new Error('AI 返回的内容不完整，请重新生成');
        }
      }
      result = parseJDDraft(draft);
    }
  }

  function consume(flush = false) {
    let end: number;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (!line) dispatch();
      else if (line.startsWith('data:')) eventLines.push(line.slice(5).replace(/^ /, ''));
      if (result) return;
    }
    if (flush) {
      if (buffer.startsWith('data:')) eventLines.push(buffer.slice(5).replace(/^ /, '').replace(/\r$/, ''));
      dispatch();
    }
  }

  try {
    while (!result) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      consume(done);
      if (done) break;
    }
    if (!result) throw new Error('AI 响应中断，草稿已保留，请重试');
    return result;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
