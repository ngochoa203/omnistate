// Run: npx tsx packages/gateway/scripts/smoke_test_voice.ts
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import WebSocket from "ws";

const BASE = "http://localhost:19800";
const SAMPLES_DIR = `${homedir()}/.omnistate/wake-samples`;
const PHRASE = "hey mimi test";

function fail(step: number, reason: string): never {
  console.error(`[smoke] FAIL step ${step}: ${reason}`);
  process.exit(1);
}

async function main() {
  // Step 1: Check samples exist
  const samplePaths = Array.from({ length: 5 }, (_, i) => `${SAMPLES_DIR}/sample_${i + 1}.wav`);
  const missing = samplePaths.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    console.error(`[smoke] FAIL step 1: Missing sample files:\n  ${missing.join("\n  ")}`);
    console.error(
      "Run the macOS app onboarding wizard first to generate samples, " +
        "or place 5 WAV files at ~/.omnistate/wake-samples/sample_N.wav."
    );
    process.exit(1);
  }
  console.log("[smoke] step 1 PASS: all 5 samples found");

  // Steps 2–6: POST each sample to /api/wake/personal-sample
  for (let i = 0; i < 5; i++) {
    const body = readFileSync(samplePaths[i]);
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/wake/personal-sample`, {
        method: "POST",
        headers: {
          "Content-Type": "audio/wav",
          "X-Sample-Index": String(i + 1),
          "X-Phrase": PHRASE,
        },
        body,
      });
    } catch (e) {
      fail(2, `Network error posting sample ${i + 1}: ${e}`);
    }
    if (res.status !== 201) {
      const text = await res.text().catch(() => "");
      fail(2, `POST personal-sample ${i + 1} returned ${res.status}: ${text}`);
    }
    console.log(`[smoke] step 2.${i + 1} PASS: sample ${i + 1} uploaded (201)`);
  }

  // Step 3: POST /api/wake/personal-train
  let trainRes: Response;
  try {
    trainRes = await fetch(`${BASE}/api/wake/personal-train`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch (e) {
    fail(3, `Network error on personal-train: ${e}`);
  }
  if (trainRes.status !== 201) {
    const text = await trainRes.text().catch(() => "");
    fail(3, `POST personal-train returned ${trainRes.status}: ${text}`);
  }
  const trainBody = await trainRes.text().catch(() => "");
  console.log(`[smoke] step 3 PASS: personal-train (201): ${trainBody}`);

  // Step 4: Transcribe sample_1.wav via WebSocket voice.transcribe message
  const audioBody = readFileSync(samplePaths[0]);
  const transcribeId = "smoke-test-1";
  const transcript = await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(BASE.replace("http://", "ws://"));
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error("timed out after 30s waiting for voice.transcript"));
    }, 30_000);
    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "voice.transcribe",
          id: transcribeId,
          audio: audioBody.toString("base64"),
          format: "wav",
        })
      );
    });
    ws.on("message", (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === "voice.transcript" && msg.id === transcribeId) {
        clearTimeout(timeout);
        ws.close();
        resolve(String(msg.text ?? ""));
      } else if (
        typeof msg.type === "string" &&
        msg.type.startsWith("voice.error") &&
        msg.id === transcribeId
      ) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`voice error: ${JSON.stringify(msg)}`));
      }
    });
  }).catch((err) => fail(4, String(err)));
  console.log(`[smoke] step 4 OK: transcription="${transcript}"`);

  console.log("[smoke] ALL PASS");
}

void main().catch((err) => {
  console.error("[smoke] Unexpected error:", err);
  process.exit(1);
});
