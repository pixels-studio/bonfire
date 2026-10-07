import type { API } from '../../shared/contracts';

/** Maps the helper's error reason to copy shown in the composer. */
export function dictationErrorMessage(error: unknown): string {
  const windows =
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
  if (error === 'not-allowed' && windows)
    return 'Microphone access is off. Turn on Settings → Privacy & security → Microphone → Let desktop apps access your microphone.';
  if (error === 'unavailable' && windows)
    return 'No speech recognition language is installed. Add one in Settings → Time & language → Speech.';
  if (error === 'not-allowed')
    return 'Microphone access was denied. Allow it in System Settings → Privacy & Security → Microphone.';
  if (error === 'service-not-allowed')
    return 'Speech recognition was denied. Allow it in System Settings → Privacy & Security → Speech Recognition.';
  if (error === 'audio-capture') return 'No microphone was found.';
  return 'Dictation could not start.';
}

export interface DictationSession {
  stop: () => void;
}

/**
 * Starts listening through the app's native dictation helper. `onText` fires with
 * everything heard so far each time it changes (earlier words may be revised); `onEnd`
 * fires once the session is over, whether stopped or failed.
 */
export async function startDictation({
  api,
  language = '',
  onText = () => {},
  onLevel = () => {},
  onEnd = () => {},
  onError = () => {},
}: {
  api: API['dictation'];
  language?: string;
  onText?: (text: string) => void;
  onLevel?: (level: number) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}): Promise<DictationSession> {
  let session: string | undefined;
  let finished = false;
  // Events can arrive before `start` resolves with the id they carry, so they wait for it.
  const early: Parameters<Parameters<typeof api.onEvent>[0]>[0][] = [];
  const handle = (event: (typeof early)[number]) => {
    if (finished || event.session !== session) return;
    if (event.type === 'result') onText(event.text);
    else if (event.type === 'level') onLevel(event.level);
    else if (event.type === 'error') onError(event.error);
    else if (event.type === 'end') {
      finished = true;
      unsubscribe();
      onLevel(0);
      onEnd();
    }
  };
  const unsubscribe = api.onEvent((event) => {
    if (session === undefined) early.push(event);
    else handle(event);
  });
  try {
    session = await api.start(language);
  } catch (error) {
    unsubscribe();
    throw error;
  }
  early.splice(0).forEach(handle);
  return {
    stop() {
      if (!finished && session) void api.stop(session);
    },
  };
}
