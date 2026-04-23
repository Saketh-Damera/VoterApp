"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Minimal types for the Web Speech API (not in lib.dom.d.ts yet)
type SRResultItem = { transcript: string; confidence: number };
type SRResult = { 0: SRResultItem; isFinal: boolean; length: number };
type SREvent = {
  resultIndex: number;
  results: { length: number; [idx: number]: SRResult };
};
type SRInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SRClass = new () => SRInstance;
declare global {
  interface Window {
    SpeechRecognition?: SRClass;
    webkitSpeechRecognition?: SRClass;
  }
}

export default function DebriefClient() {
  const router = useRouter();
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [processing, setProcessing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<null | {
    voter_ncid: string | null;
    extract: {
      captured_name: string;
      sentiment: string;
      issues: string[];
      tags: string[];
      follow_up: { days_until: number; action: string } | null;
    };
  }>(null);
  const recRef = useRef<SRInstance | null>(null);

  useEffect(() => {
    const SR = typeof window !== "undefined" ? (window.SpeechRecognition ?? window.webkitSpeechRecognition) : undefined;
    if (!SR) setSupported(false);
  }, []);

  function start() {
    setErr(null);
    setResult(null);
    setTranscript("");
    setInterim("");
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e: SREvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }
      if (finalText) setTranscript((t) => t + finalText);
      setInterim(interimText);
    };
    r.onerror = (ev: Event) => {
      setErr("Mic error: " + (ev as Event & { error?: string }).error);
      setRecording(false);
    };
    r.onend = () => {
      setRecording(false);
    };
    r.start();
    recRef.current = r;
    setRecording(true);
  }

  function stop() {
    recRef.current?.stop();
    setRecording(false);
  }

  async function process() {
    const full = (transcript + " " + interim).trim();
    if (full.length < 10) {
      setErr("Transcript too short — talk a bit longer.");
      return;
    }
    setProcessing(true);
    setErr(null);
    const res = await fetch("/api/debrief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: full }),
    });
    const json = await res.json();
    setProcessing(false);
    if (!res.ok) {
      setErr(json.error ?? "debrief failed");
      return;
    }
    setResult(json);
    router.refresh();
  }

  if (!supported) {
    return (
      <div className="card p-5 text-sm">
        <p className="mb-2 font-medium text-[var(--color-danger)]">
          This browser doesn't support the Web Speech API.
        </p>
        <p className="text-[var(--color-ink-muted)]">
          Use Chrome, Edge, or Safari on macOS/iOS. Or type your notes directly at{" "}
          <a href="/people/new" className="underline">Add Person</a>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-center justify-center">
          {!recording ? (
            <button onClick={start} className="btn-primary px-6 py-3 text-base">
              Start recording
            </button>
          ) : (
            <button onClick={stop} className="btn-primary bg-[var(--color-danger)] hover:bg-[var(--color-danger)] px-6 py-3 text-base">
              Stop
            </button>
          )}
        </div>
        {recording && (
          <p className="mt-3 text-center text-xs text-[var(--color-ink-subtle)]">
            Recording... speak naturally. "Talked to Carla, cares about Oak traffic, son at Jefferson, leans yes, wants a sign."
          </p>
        )}
      </div>

      {(transcript || interim) && (
        <div className="card p-4">
          <div className="section-label mb-2">Transcript</div>
          <p className="whitespace-pre-wrap text-sm text-[var(--color-ink)]">
            {transcript}
            <span className="text-[var(--color-ink-subtle)]">{interim}</span>
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={process}
              disabled={processing || (transcript + interim).trim().length < 10}
              className="btn-primary"
            >
              {processing ? "Claude parsing..." : "Parse & save"}
            </button>
            <button
              onClick={() => { setTranscript(""); setInterim(""); setResult(null); }}
              className="btn-secondary"
              disabled={processing}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="card bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
          {err}
        </div>
      )}

      {result && (
        <div className="card p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="section-label">Saved</div>
            {result.voter_ncid ? (
              <a href={`/people/${result.voter_ncid}`} className="btn-ghost text-xs">Open profile</a>
            ) : (
              <span className="chip chip-warning">unmatched</span>
            )}
          </div>
          <dl className="space-y-1 text-sm">
            <Row k="Name heard" v={result.extract.captured_name || "—"} />
            <Row k="Sentiment" v={result.extract.sentiment.replace(/_/g, " ")} />
            <Row k="Issues" v={result.extract.issues.join(", ") || "—"} />
            <Row k="Tags" v={result.extract.tags.join(", ") || "—"} />
            {result.extract.follow_up && (
              <Row
                k="Follow-up"
                v={`${result.extract.follow_up.action} (in ${result.extract.follow_up.days_until} days)`}
              />
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-xs uppercase tracking-wide text-[var(--color-ink-subtle)]">{k}</dt>
      <dd className="text-sm text-[var(--color-ink)]">{v}</dd>
    </div>
  );
}
