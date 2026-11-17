import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Дневной потолок расходов. Счетчики сохраняются в файл, чтобы перезапуск
// контейнера не обнулял траты. День считается по московскому времени.

/** Тарифы SpeechKit (с НДС) по странице цен на 2026-11-17. */
export const SPEECHKIT_RUB = {
  /** Синхронное распознавание: за каждые начатые 15 секунд. */
  sttPer15s: 0.1626,
  /** Синтез v3, модель general: за запрос, тарифицируется блоками по 250 знаков. */
  ttsPer250chars: 0.1626,
};

export const sttCostRub = (seconds: number) => Math.max(1, Math.ceil(seconds / 15)) * SPEECHKIT_RUB.sttPer15s;
export const ttsCostRub = (chars: number) => Math.max(1, Math.ceil(chars / 250)) * SPEECHKIT_RUB.ttsPer250chars;

export const moscowDate = (now = Date.now()) =>
  new Date(now + 3 * 3600_000).toISOString().slice(0, 10);

interface Day {
  date: string;
  llmUsd: number;
  voiceRub: number;
  requests: number;
}

export class Budget {
  private day: Day;
  private file: string;
  private limits: { dailyLlmUsd: number; dailyVoiceRub: number };
  private now: () => number;

  constructor(file: string, limits: { dailyLlmUsd: number; dailyVoiceRub: number }, now: () => number = Date.now) {
    this.file = file;
    this.limits = limits;
    this.now = now;
    this.day = this.load();
  }

  private load(): Day {
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as Day;
      if (d.date === moscowDate(this.now())) return d;
    } catch {
      /* файла еще нет */
    }
    return { date: moscowDate(this.now()), llmUsd: 0, voiceRub: 0, requests: 0 };
  }

  private today(): Day {
    const date = moscowDate(this.now());
    if (this.day.date !== date) this.day = { date, llmUsd: 0, voiceRub: 0, requests: 0 };
    return this.day;
  }

  private save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.day));
    } catch {
      /* не смогли записать: потолок все равно действует в памяти */
    }
  }

  /** Можно ли еще тратить сегодня. Если нет — почему. */
  check(): { ok: true } | { ok: false; reason: 'llm' | 'voice' } {
    const d = this.today();
    if (d.llmUsd >= this.limits.dailyLlmUsd) return { ok: false, reason: 'llm' };
    if (d.voiceRub >= this.limits.dailyVoiceRub) return { ok: false, reason: 'voice' };
    return { ok: true };
  }

  addLlm(usd: number) {
    this.today().llmUsd += usd;
    this.save();
  }

  addVoice(rub: number) {
    this.today().voiceRub += rub;
    this.save();
  }

  countRequest() {
    this.today().requests++;
    this.save();
  }

  status() {
    const d = this.today();
    return { ...d, limits: this.limits };
  }
}
