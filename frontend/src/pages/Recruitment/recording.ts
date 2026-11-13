import { useCallback, useEffect, useRef, useState } from "react";
import request from "../../utils/request";
import { getErrorMessage } from "../../utils/errors";

interface Chunk {
  key: string;
  owner: string;
  interview: string;
  session: string;
  index: number;
  blob: Blob;
}
function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("interview-recording-recovery", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("chunks", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function chunks(owner: string, interview: string): Promise<Chunk[]> {
  const db = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction("chunks").objectStore("chunks").getAll();
      req.onsuccess = () =>
        resolve(
          (req.result as Chunk[])
            .filter((c) => c.owner === owner && c.interview === interview)
            .sort(
              (a, b) => a.session.localeCompare(b.session) || a.index - b.index,
            ),
        );
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
async function persist(chunk: Chunk, remove = false) {
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("chunks", "readwrite");
      if (remove) tx.objectStore("chunks").delete(chunk.key);
      else tx.objectStore("chunks").put(chunk);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export function useRecording(
  interview: string,
  owner: string,
  refresh: () => void,
) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const session = useRef<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  const stopping = useRef(false);
  const disconnected = useRef(false);
  const prefix = `/interview-workflow/${interview}`;
  const countPending = useCallback(async () => {
    const saved = await chunks(owner, interview);
    if (mounted.current) setPending(saved.length);
    return saved;
  }, [owner, interview]);
  useEffect(() => {
    mounted.current = true;
    void countPending().catch((reason) =>
      setError(getErrorMessage(reason, "浏览器录音恢复存储不可用")),
    );
    return () => {
      mounted.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (heartbeat.current) clearInterval(heartbeat.current);
    };
  }, [countPending]);
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (recording || pending || busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording, pending, busy]);
  async function upload(chunk: Chunk) {
    const form = new FormData();
    form.append("file", chunk.blob, "chunk");
    await request.post(`${prefix}/recording/chunks`, form, {
      params: { session_id: chunk.session, index: chunk.index },
      timeout: 60000,
    });
    await persist(chunk, true);
    await countPending();
  }
  async function release(id: string) {
    await request.post(`${prefix}/recording/release`, { session_id: id });
    session.current = null;
    refresh();
  }
  async function start() {
    setBusy(true);
    setError("");
    let claimed = false;
    const id = crypto.randomUUID();
    try {
      if ((await countPending()).length)
        throw new Error("请先恢复未上传的录音分片");
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error("当前浏览器不支持录音，请使用支持麦克风的浏览器");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      await request.post(`${prefix}/recording/claim`, { session_id: id });
      claimed = true;
      session.current = id;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4"].find((mime) =>
        MediaRecorder.isTypeSupported(mime),
      );
      const capture = new MediaRecorder(
        media,
        mimeType ? { mimeType } : undefined,
      );
      recorder.current = capture;
      let index = 0;
      queue.current = Promise.resolve();
      disconnected.current = false;
      capture.ondataavailable = (event) => {
        if (!event.data.size) return;
        const part = index++;
        const chunk: Chunk = {
          key: `${owner}:${interview}:${id}:${part}`,
          owner,
          interview,
          session: id,
          index: part,
          blob: event.data,
        };
        const saved = persist(chunk).then(() => countPending());
        queue.current = queue.current
          .then(async () => {
            await saved;
            if (!disconnected.current) await upload(chunk);
          })
          .catch((reason) => {
            if (mounted.current)
              setError(
                getErrorMessage(
                  reason,
                  "上传中断，录音已保留在此浏览器，可停止后恢复上传",
                ),
              );
          });
      };
      capture.onerror = () => {
        setError("录音设备发生错误，请停止后检查已上传分片");
      };
      capture.start(5000);
      setRecording(true);
      heartbeat.current = setInterval(() => {
        request
          .post(`${prefix}/recording/heartbeat`, { session_id: id })
          .catch((reason: unknown) => {
            disconnected.current = true;
            void stop();
            if (mounted.current)
              setError(getErrorMessage(reason, "录音连接中断，请检查网络"));
          });
      }, 10000);
      refresh();
    } catch (reason) {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (claimed) await release(id).catch(() => undefined);
      setError(getErrorMessage(reason, "启动录音失败，请检查麦克风权限"));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (stopping.current) return;
    stopping.current = true;
    if (heartbeat.current) clearInterval(heartbeat.current);
    heartbeat.current = null;
    setBusy(true);
    try {
      const capture = recorder.current;
      if (capture?.state === "recording")
        await new Promise<void>((resolve) => {
          capture.addEventListener("stop", () => resolve(), { once: true });
          capture.stop();
        });
      stream.current?.getTracks().forEach((track) => track.stop());
      setRecording(false);
      await queue.current;
      const saved = await countPending();
      if (saved.length)
        throw new Error(`仍有 ${saved.length} 个分片待上传，请点击恢复上传`);
      if (session.current) await release(session.current);
    } catch (reason) {
      setError(getErrorMessage(reason, "录音保存失败，请恢复上传"));
    } finally {
      if (heartbeat.current) clearInterval(heartbeat.current);
      heartbeat.current = null;
      stopping.current = false;
      setBusy(false);
      refresh();
    }
  }
  async function recover() {
    setBusy(true);
    setError("");
    try {
      const saved = await countPending();
      for (const id of new Set(saved.map((c) => c.session))) {
        await request.post(`${prefix}/recording/claim`, { session_id: id });
        for (const chunk of saved.filter((c) => c.session === id))
          await upload(chunk);
        await release(id);
      }
      if (!saved.length && session.current) await release(session.current);
      refresh();
    } catch (reason) {
      setError(
        getErrorMessage(reason, "恢复上传失败，请等待原录音会话释放后重试"),
      );
    } finally {
      setBusy(false);
    }
  }
  return { recording, busy, pending, error, start, stop, recover };
}
