import { createServer } from 'node:http';
import { createDeps, createHandler } from './app.ts';
import { loadConfig } from './config.ts';

const cfg = loadConfig();
const missing = [
  !cfg.accessCode && 'ACCESS_CODE',
  !cfg.openrouter.apiKey && 'OPENROUTER_API_KEY',
  !cfg.yandex.apiKey && 'YANDEX_API_KEY',
].filter(Boolean);
if (missing.length) console.warn(`Не заданы: ${missing.join(', ')}. Разговор работать не будет.`);

createServer(createHandler(createDeps(cfg))).listen(cfg.port, () => {
  console.log(
    `Пушок слушает порт ${cfg.port}. Модель ${cfg.openrouter.model} у ${cfg.openrouter.provider}, ` +
      `потолок $${cfg.limits.dailyLlmUsd} + ${cfg.limits.dailyVoiceRub} ₽ в день.`,
  );
});
