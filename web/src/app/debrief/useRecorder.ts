"use client";

import { useEffect, useRef, useState } from "react";

export type RecorderState = {
  recording: boolean;
  transcribing: boolean;
  elapsed: number;
  voiceNote: string | null;
  err: string | null;
  recSupported: boolean;
};

export type RecorderControls = {
  start: () => Promise<void>;
  stop: () => void;
  pickFile: (file: File | null | undefined) => Promise<void>;
  reset: () => void;
};

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

// Encapsulates MediaRecorder lifecycle, file-upload-as-fallback, and
// /api/transcribe call. Calls onTranscript with each chunk of recognized
// text so the parent can append into a textarea.
export function useRecorder(opts: { onTranscript: (text: string) => void }): RecorderState & RecorderControls {
  const { onTranscript } = opts;
  const [recSupported, setRecSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The check has to run on the client (MediaRecorder is undefined on the
  // server). useState defaults to true; the effect downgrades on mount if
  // the platform actually doesn't support recording.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecSupported(false);
    }
  }, []);

  // Cleanup on unmount: stop any active stream / timer.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function transcribeForm(form: FormData) {
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) {
      setErr(json.error ?? "transcription failed");
      return;
    }
    const text = (json.text as string).trim();
    if (!text) {
      setVoiceNote("No speech recognized.");
      return;
    }
    onTranscript(text);
  }

  async function uploadAndTranscribe(mimeType: string) {
    setTranscribing(true);
    setErr(null);
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
      if (blob.size < 500) {
        setVoiceNote("Recording was too short to transcribe. Try again.");
        return;
      }
      const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
      const form = new FormData();
      form.append("audio", blob, `debrief.${ext}`);
      await transcribeForm(form);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setTranscribing(false);
    }
  }

  async function start() {
    setErr(null);
    setVoiceNote(null);
    if (!recSupported) {
      setVoiceNote("This browser doesn't support in-page recording. Type below instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => uploadAndTranscribe(mr.mimeType);
      mr.start();
      recorderRef.current = mr;
      streamRef.current = stream;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (e) {
      const name = (e as Error & { name?: string }).name;
      if (name === "NotAllowedError") {
        setVoiceNote("Mic permission denied. Allow microphone access in the address bar and try again.");
      } else if (name === "NotFoundError") {
        setVoiceNote("No microphone found. Plug one in or type below.");
      } else {
        setVoiceNote(`Couldn't start recording: ${(e as Error).message}`);
      }
    }
  }

  function stop() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    const mr = recorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function pickFile(file: File | null | undefined) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setErr("Audio file too large (max 25 MB).");
      return;
    }
    setErr(null);
    setVoiceNote(null);
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("audio", file, file.name);
      await transcribeForm(form);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setTranscribing(false);
    }
  }

  function reset() {
    setErr(null);
    setVoiceNote(null);
    setElapsed(0);
  }

  return {
    recording,
    transcribing,
    elapsed,
    voiceNote,
    err,
    recSupported,
    start,
    stop,
    pickFile,
    reset,
  };
}

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
