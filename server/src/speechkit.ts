import type { Config } from './config.ts';

// Yandex SpeechKit: распознавание (v1, синхронное, до 30 с, LPCM 16 кГц)
// и синтез (v3 REST, ответ потоком JSON-строк с кусками WAV в base64).

type Yx = Config['yandex'];

const authHeaders = (y: Yx): Record<string, string> => ({
  Authorization: `Api-Key ${y.apiKey}`,
  ...(y.folderId ? { 'x-folder-id': y.folderId } : {}),
});

export class SpeechError extends Error {}

/** Распознать речь: PCM 16 бит, моно, 16 кГц. */
export async function recognize(y: Yx, pcm: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<string> {
  const q = new URLSearchParams({ lang: 'ru-RU', format: 'lpcm', sampleRateHertz: '16000' });
  if (y.folderId) q.set('folderId', y.folderId);
  const res = await fetchImpl(`https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?${q}`, {
    method: 'POST',
    headers: { Authorization: `Api-Key ${y.apiKey}` },
    body: new Uint8Array(pcm),
  });
  if (!res.ok) throw new SpeechError(`STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { result?: string };
  return (data.result ?? '').trim();
}

/** Разбить текст на куски до 250 знаков по предложениям: так каждый кусок — один тарифный блок. */
export function splitForTts(text: string, max = 250): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = '';
    }
    if (s.length > max) {
      // очень длинное предложение режем по словам
      for (const w of s.split(/\s+/)) {
        if ((cur + ' ' + w).length > max && cur) {
          out.push(cur.trim());
          cur = '';
        }
        cur += (cur ? ' ' : '') + w;
      }
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Озвучить текст: возвращает WAV-файлы (по одному на кусок текста). */
export async function synthesize(y: Yx, text: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array[]> {
  const parts = splitForTts(text);
  return Promise.all(parts.map((part) => synthesizeOne(y, part, fetchImpl)));
}

async function synthesizeOne(y: Yx, text: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const res = await fetchImpl('https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis', {
    method: 'POST',
    headers: { ...authHeaders(y), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, hints: [{ voice: y.voice }, ...(y.role ? [{ role: y.role }] : [])] }),
  });
  if (!res.ok) throw new SpeechError(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.text();
  const chunks: Uint8Array[] = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const data = (JSON.parse(t) as { result?: { audioChunk?: { data?: string } } }).result?.audioChunk?.data;
      if (data) chunks.push(Buffer.from(data, 'base64'));
    } catch {
      /* служебная строка */
    }
  }
  if (!chunks.length) throw new SpeechError('TTS: пустой ответ');
  return Buffer.concat(chunks);
}

/** Длительность PCM 16 кГц 16 бит моно в секундах. */
export const pcmSeconds = (bytes: number) => bytes / 32000;
