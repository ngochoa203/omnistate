import { detectLanguage, pickVoice, synthesize } from "./edge-tts.js";

/** Regex that matches sentence-ending boundaries for flush decisions */
const SENTENCE_END = /[.!?…。！？]\s|[\n]{2,}/;

/** Flush buffer when accumulated text exceeds this many characters */
const FLUSH_CHAR_THRESHOLD = 200;

export interface TtsChunk {
  seq: number;
  audio: Buffer;
  eos: boolean;
}

export interface StreamingTtsOpts {
  sessionId: string;
  lang?: "vi" | "en";
  voice?: string;
  signal: AbortSignal;
}

export class StreamingTTS {
  /**
   * Consume a stream of text deltas, synthesize per sentence, and yield
   * audio chunks in sequence order.  The final chunk always has eos:true
   * (even on abort — an empty Buffer sentinel is emitted).
   */
  async *synthesize(
    text$: AsyncIterable<string>,
    opts: StreamingTtsOpts,
  ): AsyncIterable<TtsChunk> {
    const { lang, voice, signal } = opts;

    // Queue of synthesis promises in arrival order — emitted in seq order.
    const synthQueue: Array<Promise<Buffer | null>> = [];
    let nextSeq = 0;
    let aborted = false;

    signal.addEventListener("abort", () => { aborted = true; }, { once: true });

    // Phase 1: schedule synthesis tasks while consuming text$
    const schedulePhase = (async () => {
      let buf = "";

      const enqueue = (text: string) => {
        const resolvedLang = lang ?? detectLanguage(text);
        const resolvedVoice = voice ?? pickVoice(resolvedLang);
        synthQueue.push(
          synthesize(text, { lang: resolvedLang, voice: resolvedVoice, signal }).catch(() => null),
        );
        nextSeq++;
      };

      for await (const delta of text$) {
        if (aborted) break;
        buf += delta;

        if (SENTENCE_END.test(buf)) {
          // Split on boundaries; keep the trailing incomplete fragment
          const parts = buf.split(SENTENCE_END);
          const toFlush = parts.slice(0, -1).join(" ").trim();
          buf = parts[parts.length - 1];
          if (toFlush) enqueue(toFlush);
        } else if (buf.length >= FLUSH_CHAR_THRESHOLD) {
          enqueue(buf.trim());
          buf = "";
        }
      }

      // Flush remaining text (not aborted path)
      if (!aborted && buf.trim()) {
        enqueue(buf.trim());
      }
    })();

    // Phase 2: drain synthQueue in order once items are available
    let scheduleSettled = false;
    schedulePhase.then(() => { scheduleSettled = true; }, () => { scheduleSettled = true; });

    let emittedSeq = 0;
    let emittedEos = false;

    while (true) {
      if (emittedSeq < synthQueue.length) {
        const audio = await synthQueue[emittedSeq];
        const seq = emittedSeq;
        emittedSeq++;

        const isLast = scheduleSettled && emittedSeq === synthQueue.length;

        yield {
          seq,
          audio: audio ?? Buffer.alloc(0),
          eos: isLast,
        };

        if (isLast) {
          emittedEos = true;
          break;
        }

        // If aborted and we have nothing more queued yet and schedule is done, stop
        if (aborted && scheduleSettled && emittedSeq >= synthQueue.length) {
          break;
        }
      } else if (scheduleSettled) {
        // No items were ever enqueued (e.g. empty input or immediate abort)
        break;
      } else {
        // Wait for schedule phase to enqueue more items
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    // Always close the stream with an eos sentinel if one wasn't emitted yet
    if (!emittedEos) {
      yield { seq: emittedSeq, audio: Buffer.alloc(0), eos: true };
    }
  }
}
