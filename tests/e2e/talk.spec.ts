import { expect, test, type Page, type Route } from '@playwright/test';

// Комната «Разговор» с поддельным сервером (никаких настоящих запросов и расходов)
// и поддельным микрофоном Chromium. В WebKit микрофона нет — там только проверка «без настройки».

const SHOTS = 'test-results/screens';
const SERVER = 'https://pushok.test';

type Dbg = { app: { frames: number; scene: { id: string; phase?: string; why?: string }; targetCss(id: string): { x: number; y: number } | null } };
const ready = (page: Page) => page.waitForFunction(() => ((window as unknown as { __piki?: Dbg }).__piki?.app.frames ?? 0) > 5);
const scene = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __piki: Dbg }).__piki.app.scene;
    return { id: s.id, phase: s.phase, why: s.why };
  });
const center = async (page: Page, id: string) => {
  const c = await page.evaluate((id) => (window as unknown as { __piki: Dbg }).__piki.app.targetCss(id), id);
  expect(c, id).not.toBeNull();
  return c!;
};
const tap = async (page: Page, id: string) => {
  const c = await center(page, id);
  await page.touchscreen.tap(c.x, c.y);
};
const save = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('piki-pushok.save')!));

/** Короткий WAV: 0.2 с тишины, 16 кГц. */
function wavBase64() {
  const n = 3200;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  return b.toString('base64');
}

async function withTalkSave(page: Page, talk: Record<string, unknown>) {
  await page.addInitScript((talk) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    const now = Date.now();
    localStorage.setItem(
      'piki-pushok.save',
      JSON.stringify({
        version: 2, createdAt: now, coins: 0, butterfliesTotal: 0, satiety: { value: 100, at: now },
        basket: {}, dishes: [], unlocked: { hats: [], guitars: [], sweaters: [] }, seen: [],
        equipped: { hat: null, guitar: null, sweater: null }, settings: { sound: true },
        home: { pushokAt: null, sleeping: false }, night: null, stars: { count: 5, seen: 5, log: [] },
        talk: { enabled: true, serverUrl: '', code: '', day: '', usedMs: 0, extraMs: 0, warned: false, notebook: null, history: [], ...talk },
      }),
    );
  }, talk);
  await page.goto('./?nohint');
  await ready(page);
}

interface Mock {
  talks: Record<string, unknown>[];
  status?: number;
  body?: unknown;
  /** Что добавить к ответу на фразу (эмоция, действие). */
  extra?: Record<string, unknown>;
}

type Dbg2 = { app: { game: { talk: { phase: string; on: boolean; place: string } }; scene: { id: string; pushok?: { busy: string | null } } } };
const talkState = (page: Page) =>
  page.evaluate(() => {
    const a = (window as unknown as { __piki: Dbg2 }).__piki.app;
    return { phase: a.game.talk.phase, on: a.game.talk.on, place: a.game.talk.place, scene: a.scene.id, busy: a.scene.pushok?.busy ?? null };
  });

async function mockServer(page: Page, m: Mock) {
  await page.route(`${SERVER}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/seed') return route.fulfill({ json: { notebook: { stories: [{ title: 'Лесная', stoppedAt: 'Тимка у речки' }], currentStory: 'Лесная', news: [], notesForParents: [] } }, headers: cors });
    if (url.pathname === '/health') return route.fulfill({ json: { ok: true, model: 'z-ai/glm-5.3', provider: 'wafer/us', budget: { llmUsd: 0.01, voiceRub: 2, limits: { dailyLlmUsd: 0.3, dailyVoiceRub: 60 } } }, headers: cors });
    if (url.pathname === '/notebook') return route.fulfill({ json: { notebook: JSON.parse(route.request().postData() ?? '{}').notebook, changed: false }, headers: cors });
    if (url.pathname === '/talk') {
      const body = JSON.parse(route.request().postData() ?? '{}');
      m.talks.push(body);
      if (m.status) return route.fulfill({ status: m.status, json: m.body ?? {}, headers: cors });
      return route.fulfill({
        json: {
          heard: body.audio ? 'а что было дальше' : '',
          reply: body.event === 'start' ? 'Привет! Продолжим про Лесную сказку?' : body.event === 'end' ? 'До завтра!' : 'Тимка пошел к речке!',
          audio: [wavBase64()],
          ...(body.audio ? m.extra : {}),
        },
        headers: cors,
      });
    }
    return route.fulfill({ status: 404, headers: cors });
  });
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code' };

test('разговор: пока сервер не настроен, кнопки разговора в домике нет', async ({ page }) => {
  await withTalkSave(page, {});
  const noBtn = await page.evaluate(() => (window as unknown as { __piki: Dbg }).__piki.app.targetCss('btn:talk'));
  expect(noBtn).toBeNull();
});

test('разговор: неверный код — Пушок спит, без падений', async ({ page }, info) => {
  await page.route(`${SERVER}/**`, (route) =>
    route.fulfill({ status: route.request().method() === 'OPTIONS' ? 204 : 401, json: { error: 'код' }, headers: cors }),
  );
  await withTalkSave(page, { serverUrl: SERVER, code: 'wrong' });
  await tap(page, 'btn:talk');
  await expect.poll(async () => (await scene(page)).phase).toBe('offline');
  expect((await scene(page)).why).toBe('auth');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-talk-offline.png` });
});

test('разговор: приветствие, запись, ответ, история и тетрадка', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'поддельный микрофон есть только в Chromium');
  const m: Mock = { talks: [] };
  await mockServer(page, m);
  await withTalkSave(page, { serverUrl: SERVER, code: 'test-code' });
  await tap(page, 'btn:talk');
  // приветствие: событие start, тетрадка с сервера
  await expect.poll(() => m.talks.length).toBe(1);
  expect(m.talks[0].event).toBe('start');
  expect((m.talks[0].notebook as { currentStory: string }).currentStory).toBe('Лесная');
  // после приветствия Пушок слушает сам, без кнопки
  await expect.poll(async () => (await scene(page)).phase, { timeout: 5000 }).toBe('listening');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-talk-listening.png` });

  // касание кнопки — «я договорила»: отправляется то, что слышно
  await tap(page, 'mic');
  await expect.poll(() => m.talks.length, { timeout: 5000 }).toBe(2);
  const sent = m.talks[1] as { audio: string; history: { role: string; text: string }[]; outfit: string; place: string; quiet: boolean };
  expect(sent.audio.length).toBeGreaterThan(1000);
  expect(sent.place).toBe('talk');
  expect(sent.quiet).toBe(false);
  expect(sent.history.at(-1)).toEqual({ role: 'pushok', text: 'Привет! Продолжим про Лесную сказку?' });
  await expect.poll(async () => (await scene(page)).phase, { timeout: 5000 }).toBe('listening');
  const h = (await save(page)).talk.history.map((t: { role: string; text: string }) => `${t.role}:${t.text}`);
  expect(h).toEqual(['event:[Событие: начало разговора]', 'pushok:Привет! Продолжим про Лесную сказку?', 'kira:а что было дальше', 'pushok:Тимка пошел к речке!']);
  // минуты считаются
  await page.waitForTimeout(5500);
  expect((await save(page)).talk.usedMs).toBeGreaterThan(3000);
});

test('разговор: «покатайся с горки» — Пушок бежит в домик и катается, разговор идет дальше; в облачке пауза', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium');
  const m: Mock = { talks: [], extra: { action: 'slide', tags: '[действие: горка]' } };
  await mockServer(page, m);
  await withTalkSave(page, { serverUrl: SERVER, code: 'c', notebook: { stories: [] } });
  await tap(page, 'btn:talk');
  await expect.poll(async () => (await talkState(page)).phase, { timeout: 5000 }).toBe('listening');
  await tap(page, 'mic');
  await expect.poll(async () => (await talkState(page)).scene, { timeout: 5000 }).toBe('home');
  const st = await talkState(page);
  expect(st).toMatchObject({ busy: 'slide', on: true, place: 'home' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-talk-home-slide.png` });
  // пометка остается в истории: модель видит, что делала
  expect((await save(page)).talk.history.at(-1)).toMatchObject({ role: 'pushok', text: 'Тимка пошел к речке!', tags: '[действие: горка]' });
  // после горки снова слушает — уже в домике
  await expect.poll(async () => (await talkState(page)).phase, { timeout: 15000 }).toBe('listening');
  // в облачке разговор на паузе, в домике — снова слушает
  await tap(page, 'btn:cloud');
  await expect.poll(async () => (await talkState(page)).phase).toBe('idle');
  await tap(page, 'btn:home');
  await expect.poll(async () => (await talkState(page)).phase, { timeout: 5000 }).toBe('listening');
  // фраза из домика уходит с местом «домик»
  const n = m.talks.length;
  await page.waitForTimeout(1200); // чтобы набралось больше 0.4 с звука
  await page.evaluate(() => (window as unknown as { __piki: { app: { game: { talk: { rec: { finish(): void } } } } } }).__piki.app.game.talk.rec.finish());
  await expect.poll(() => m.talks.length, { timeout: 5000 }).toBe(n + 1);
  expect(m.talks.at(-1)!.place).toBe('home');
});

test('разговор: эмоция из ответа — Пушок радуется в комнате разговора', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium');
  const m: Mock = { talks: [], extra: { emotion: 'joy', tags: '[эмоция: радость]' } };
  await mockServer(page, m);
  await withTalkSave(page, { serverUrl: SERVER, code: 'c', notebook: { stories: [] } });
  await tap(page, 'btn:talk');
  await expect.poll(async () => (await talkState(page)).phase, { timeout: 5000 }).toBe('listening');
  await tap(page, 'mic');
  await expect.poll(async () => (await talkState(page)).busy, { timeout: 5000, intervals: [40] }).toBe('emotion');
  expect((await talkState(page)).scene).toBe('talk');
});

test('разговор: вертикально комната разговора стоит, а домик просит повернуть', async ({ page }, info) => {
  const m: Mock = { talks: [] };
  await mockServer(page, m);
  await withTalkSave(page, { serverUrl: SERVER, code: 'c', notebook: { stories: [] } });
  await tap(page, 'btn:talk');
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.waitForTimeout(600);
  const layout = await page.evaluate(() => {
    const a = (window as unknown as { __piki: { app: { layout: { portrait: boolean; view: { x1: number; y1: number } }; targetCss(id: string): { x: number; y: number } | null } } }).__piki.app;
    return { portrait: a.layout.portrait, w: a.layout.view.x1, mic: a.targetCss('mic') };
  });
  expect(layout.portrait).toBe(true);
  expect(layout.mic).not.toBeNull();
  // кнопка-микрофон внизу по центру экрана
  expect(Math.abs(layout.mic!.x - vp.height / 2)).toBeLessThan(vp.height * 0.1);
  expect(layout.mic!.y).toBeGreaterThan(vp.width * 0.6);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-talk-portrait.png` });
  await tap(page, 'btn:home');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-home-portrait-rotate.png` });
});

test('разговор: дневной потолок расходов — Пушок спит до завтра', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium');
  const m: Mock = { talks: [], status: 429, body: { error: 'budget', reason: 'llm' } };
  await mockServer(page, m);
  await withTalkSave(page, { serverUrl: SERVER, code: 'c', notebook: { stories: [] } });
  await tap(page, 'btn:talk');
  await expect.poll(async () => (await scene(page)).phase).toBe('sleeping');
  expect((await scene(page)).why).toBe('budget');
});

test('разговор: 20 минут закончились — Пушок прощается и засыпает', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium');
  const m: Mock = { talks: [] };
  await mockServer(page, m);
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await withTalkSave(page, { serverUrl: SERVER, code: 'c', notebook: { stories: [] }, day, usedMs: 20 * 60_000 - 1500, warned: true });
  await tap(page, 'btn:talk');
  await expect.poll(() => m.talks.map((t) => t.event), { timeout: 8000 }).toEqual(['start', 'end']);
  await expect.poll(async () => (await scene(page)).phase, { timeout: 5000 }).toBe('sleeping');
  expect((await scene(page)).why).toBe('time');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-talk-sleeping.png` });
  // на следующий заход сразу спит, без запросов
  await tap(page, 'btn:home');
  await expect.poll(async () => (await scene(page)).id).toBe('home');
  await tap(page, 'btn:talk');
  await expect.poll(async () => (await scene(page)).phase).toBe('sleeping');
  expect(m.talks).toHaveLength(2);
});

test('разговор: в панели взрослых адрес, код и проверка связи', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium');
  const m: Mock = { talks: [] };
  await mockServer(page, m);
  await withTalkSave(page, {});
  const g = await center(page, 'gear');
  await page.evaluate(([x, y]) => document.getElementById('game')!.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 7, bubbles: true })), [g.x, g.y]);
  await page.waitForTimeout(3300);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 })));
  await expect(page.locator('.adult')).toBeVisible();
  await page.getByPlaceholder('Адрес сервера, https://...').fill(SERVER);
  await page.getByPlaceholder('Код доступа').fill('test-code');
  await page.getByRole('button', { name: 'Сохранить и проверить связь' }).click();
  await expect(page.locator('.talk .check-note')).toContainText('Связь есть. Модель z-ai/glm-5.3 (wafer/us)');
  expect((await save(page)).talk).toMatchObject({ serverUrl: SERVER, code: 'test-code' });
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-talk-panel.png` });
});
