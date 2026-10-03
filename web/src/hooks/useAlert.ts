import { useCallback, useEffect, useRef } from 'react';

/**
 * In-app alert while the worker app is OPEN: repeats sound + vibration every few seconds
 * until the worker opens/acknowledges the new request(s).
 * (When the app is closed/in background, the system notification from the service worker
 * is what alerts the worker.)
 *
 * Browser limits respected, not bypassed:
 *  - Audio may only start after a user interaction with the page (autoplay policy).
 *  - navigator.vibrate is unsupported on iOS and needs prior user interaction on Android.
 *  - Silent / Do-Not-Disturb modes are controlled by the OS.
 */
const VIBRATION = [600, 250, 600, 250, 900];
const REPEAT_MS = 6000;

let sharedAudio: HTMLAudioElement | null = null;
function audio(): HTMLAudioElement {
  sharedAudio ??= new Audio('/sounds/alert.wav');
  return sharedAudio;
}

/** Plays the alert once (also used by the "test sound" button). Returns false if blocked. */
export async function playAlertOnce(): Promise<boolean> {
  try {
    navigator.vibrate?.(VIBRATION);
  } catch {
    /* unsupported */
  }
  try {
    const a = audio();
    a.currentTime = 0;
    await a.play();
    return true;
  } catch {
    return false;
  }
}

/** Unlocks audio on the first tap so later alerts can play (autoplay policy). */
export function useUnlockAudioOnFirstInteraction(): void {
  useEffect(() => {
    const unlock = () => {
      const a = audio();
      a.muted = true;
      a.play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        })
        .catch(() => {
          a.muted = false;
        });
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);
}

export function useRepeatingAlert(active: boolean): void {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    try {
      navigator.vibrate?.(0);
    } catch {
      /* ignore */
    }
    sharedAudio?.pause();
  }, []);

  useEffect(() => {
    if (!active) {
      stop();
      return;
    }
    const ring = () => {
      if (document.visibilityState === 'visible') void playAlertOnce();
    };
    ring();
    timer.current = setInterval(ring, REPEAT_MS);
    return stop;
  }, [active, stop]);
}
