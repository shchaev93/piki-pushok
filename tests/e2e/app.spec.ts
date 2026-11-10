import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'test-results/screens';
const ORIGIN = 'http://localhost:4173';

type Piki = {
  app: {
    frames: number;
    targetCss(id: string): { x: number; y: number } | null;
    targetSizesCss(): { id: string; w: number; h: number }[];
    home: { pushok: { x: number; y: number; busy: string | null } };
  };
};
const piki = (page: Page) => page.evaluateHandle(() => (window as unknown as { __piki: Piki }).__piki);

async function ready(page: Page) {
  await page.waitForFunction(() => ((window as unknown as { __piki?: Piki }).__piki?.app.frames ?? 0) > 5);
}

async function center(page: Page, id: string) {
  const h = await piki(page);
  const c = await h.evaluate((p, id) => p.app.targetCss(id), id);
  expect(c, id).not.toBeNull();
  return c!;
}

/** Удержание пальца: синтетические pointer-события работают одинаково в WebKit и Chromium. */
async function hold(page: Page, x: number, y: number, ms: number) {
  await page.evaluate(
    ([x, y]) =>
      document
        .getElementById('game')!
        .dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 7, bubbles: true })),
    [x, y],
  );
  await page.waitForTimeout(ms);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 })));
}

test('во вкладке браузера показывается инструкция, потом домик; нет внешних запросов', async ({ page }, info) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  await page.goto('./');
  await expect(page.locator('.hint')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-1-hint.png` });
  await page.locator('.hint button').click();
  await ready(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-2-home.png` });
  expect(external).toEqual([]);
});

test('все цели касания не меньше 64 CSS px', async ({ page }) => {
  await page.goto('./?nohint');
  await ready(page);
  const sizes = await (await piki(page)).evaluate((p) => p.app.targetSizesCss());
  expect(sizes.length).toBeGreaterThanOrEqual(14);
  for (const s of sizes) {
    expect(s.w, s.id).toBeGreaterThanOrEqual(64);
    expect(s.h, s.id).toBeGreaterThanOrEqual(64);
  }
});

test('тап по каждому предмету запускает занятие (скриншоты в процессе)', async ({ page }, info) => {
  await page.goto('./?nohint');
  await ready(page);
  const ids = ['bed', 'climber', 'bath', 'toilet', 'kitchen', 'trampoline', 'slide', 'rope'];
  for (const id of ids) {
    const c = await center(page, `obj:${id}`);
    await page.touchscreen.tap(c.x, c.y);
    await expect
      .poll(async () => (await piki(page)).evaluate((p) => p.app.home.pushok.busy))
      .toBe(id);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-act-${id}.png` });
    // ждем окончания занятия
    await expect
      .poll(async () => (await piki(page)).evaluate((p) => p.app.home.pushok.busy), { timeout: 12_000 })
      .toBeNull();
  }
});

test('место Пушка сохраняется после перезагрузки', async ({ page }) => {
  await page.goto('./?nohint');
  await ready(page);
  const c = await center(page, 'obj:trampoline');
  await page.touchscreen.tap(c.x, c.y);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('piki-pushok.save')!).home.pushokAt);
  expect(saved).toBe('trampoline');
  await page.reload();
  await ready(page);
  const pos = await (await piki(page)).evaluate((p) => ({ x: p.app.home.pushok.x, y: p.app.home.pushok.y }));
  expect(pos).toEqual({ x: 21, y: 88 });
});

test('шестеренка: короткое касание не открывает, удержание 3 с открывает; звук и сброс', async ({ page }, info) => {
  await page.goto('./?nohint');
  await ready(page);
  const g = await center(page, 'gear');
  await hold(page, g.x, g.y, 1000);
  await expect(page.locator('.adult')).toBeHidden();
  await hold(page, g.x, g.y, 3300);
  await expect(page.locator('.adult')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-adult.png` });

  await page.getByRole('button', { name: 'Звук: включен' }).click();
  await expect(page.getByRole('button', { name: 'Звук: выключен' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть' }).click();

  // сохранение звука переживает перезагрузку
  await page.reload();
  await ready(page);
  await hold(page, g.x, g.y, 3300);
  await expect(page.getByRole('button', { name: 'Звук: выключен' })).toBeVisible();

  // сброс: короткое нажатие ничего не делает, удержание 3 с сбрасывает
  await page.evaluate(() =>
    localStorage.setItem(
      'piki-pushok.save',
      JSON.stringify({ ...JSON.parse(localStorage.getItem('piki-pushok.save')!), coins: 7 }),
    ),
  );
  const btn = page.locator('.hold-btn');
  const press = async (ms: number) => {
    await btn.dispatchEvent('pointerdown', { pointerId: 3 });
    await page.waitForTimeout(ms);
    await btn.dispatchEvent('pointerup', { pointerId: 3 });
  };
  await press(800);
  await expect(page.locator('.adult .note')).toHaveText('');
  await press(3300);
  await expect(page.locator('.adult .note')).toHaveText('Прогресс сброшен.');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('piki-pushok.save')!));
  expect(after.coins).toBe(0);
  expect(after.settings.sound).toBe(false);
});

test('вертикально: экран «поверни»', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?nohint');
  await ready(page);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-portrait.png` });
});

test('страница #sprites', async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet-chromium', 'одного скриншота достаточно');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./#sprites');
  await expect(page.locator('figure').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/sprites.png`, fullPage: true });
});

test('работает офлайн после первой загрузки', async ({ page, context, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'service worker проверяем в Chromium');
  await page.goto('./?nohint');
  await ready(page);
  const swOk = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(swOk).toBe(true);
  await context.setOffline(true);
  await page.goto('./');
  const hint = page.locator('.hint button');
  if (await hint.isVisible()) await hint.click();
  await ready(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-offline.png` });
  await context.setOffline(false);
});

// ---------- этап 2: облачко ----------

type CloudDbg = {
  id: string;
  caught: number;
  currentPhase: string;
  cloudPos: { x: number; y: number };
  debugSpawnAtCloud(kind: 'butterfly' | 'apple'): void;
  debugFinish(): void;
};
const cloud = async (page: Page) =>
  (await piki(page)).evaluate((p) => {
    const s = (p.app as unknown as { scene: CloudDbg }).scene;
    return { id: s.id, caught: s.caught, phase: s.currentPhase, pos: s.cloudPos };
  });

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await page.evaluate(
    ([fx, fy, tx, ty, n]) => {
      const c = document.getElementById('game')!;
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: fx, clientY: fy, pointerId: 9, bubbles: true }));
      for (let i = 1; i <= n; i++) {
        window.dispatchEvent(
          new PointerEvent('pointermove', { clientX: fx + ((tx - fx) * i) / n, clientY: fy + ((ty - fy) * i) / n, pointerId: 9 }),
        );
      }
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: tx, clientY: ty, pointerId: 9 }));
    },
    [from.x, from.y, to.x, to.y, steps] as const,
  );
}

test('облачко: тянется пальцем, бабочка = денежка (сразу сохраняется), конец раунда', async ({ page }, info) => {
  await page.goto('./?nohint');
  await ready(page);
  const b = await center(page, 'btn:cloud');
  await page.touchscreen.tap(b.x, b.y);
  await expect.poll(async () => (await cloud(page)).id).toBe('cloud');

  // тянем в любом месте экрана: облачко сдвигается на столько же
  const before = (await cloud(page)).pos;
  const vp = page.viewportSize()!;
  await drag(page, { x: vp.width * 0.3, y: vp.height * 0.7 }, { x: vp.width * 0.3 + 120, y: vp.height * 0.7 - 40 });
  await page.waitForTimeout(800);
  const after = (await cloud(page)).pos;
  expect(after.x).toBeGreaterThan(before.x + 10);
  expect(after.y).toBeLessThan(before.y - 3);

  // поймали 2 бабочки и яблочко
  const sat0 = await page.evaluate(() => JSON.parse(localStorage.getItem('piki-pushok.save') ?? '{"satiety":{"value":100}}').satiety.value);
  for (const k of ['butterfly', 'butterfly', 'apple'] as const) {
    await (await piki(page)).evaluate((p, k) => (p.app as unknown as { scene: CloudDbg }).scene.debugSpawnAtCloud(k), k);
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => (await cloud(page)).caught).toBe(2);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('piki-pushok.save')!));
  expect(saved.coins).toBe(2);
  expect(saved.butterfliesTotal).toBe(2);
  expect(saved.satiety.value).toBeGreaterThanOrEqual(Math.min(100, sat0)); // яблочко не уменьшает сытость
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-cloud-play.png` });

  // конец раунда: итог с бабочками и кнопками
  await (await piki(page)).evaluate((p) => (p.app as unknown as { scene: CloudDbg }).scene.debugFinish());
  await expect.poll(async () => (await cloud(page)).phase, { timeout: 5000 }).toBe('summary');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-cloud-summary.png` });
  const home = await center(page, 'btn:home2');
  await page.touchscreen.tap(home.x, home.y);
  await expect.poll(async () => (await cloud(page)).id).toBe('home');
});

test('облачко: выйти домой можно в любой момент, пойманное засчитано', async ({ page }) => {
  await page.goto('./?nohint');
  await ready(page);
  const b = await center(page, 'btn:cloud');
  await page.touchscreen.tap(b.x, b.y);
  await expect.poll(async () => (await cloud(page)).id).toBe('cloud');
  await (await piki(page)).evaluate((p) => (p.app as unknown as { scene: CloudDbg }).scene.debugSpawnAtCloud('butterfly'));
  await expect.poll(async () => (await cloud(page)).caught).toBe(1);
  const h = await center(page, 'btn:home');
  await page.touchscreen.tap(h.x, h.y);
  await expect.poll(async () => (await cloud(page)).id).toBe('home');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('piki-pushok.save')!));
  expect(saved.butterfliesTotal).toBe(1);
});

// ---------- этап 3: голод, магазин, кормление ----------

const sceneId = async (page: Page) => (await piki(page)).evaluate((p) => (p.app as unknown as { scene: { id: string } }).scene.id);
const save = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('piki-pushok.save')!));

/** Подложить сохранение до запуска игры (один раз за вкладку). */
async function withSave(page: Page, patch: Record<string, unknown>) {
  await page.addInitScript((patch) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    const now = Date.now();
    const p = { ...(patch as Record<string, unknown>) };
    const value = (p.satietyValue as number | undefined) ?? 100;
    delete p.satietyValue;
    const base = {
      version: 2, createdAt: now, coins: 0, butterfliesTotal: 0, satiety: { value, at: now },
      basket: {}, dishes: [], unlocked: { hats: [], guitars: [] }, seen: [],
      equipped: { hat: null, guitar: null }, settings: { sound: true }, home: { pushokAt: null },
    };
    localStorage.setItem('piki-pushok.save', JSON.stringify({ ...base, ...p }));
  }, patch);
  await page.goto('./?nohint');
  await ready(page);
}

async function dragTo(page: Page, from: { x: number; y: number }, toScene: { x: number; y: number }) {
  const to = await (await piki(page)).evaluate((p, t) => (p.app as unknown as { toCss(x: number, y: number): { x: number; y: number } }).toCss(t.x, t.y), toScene);
  await drag(page, from, to, 16);
}

test('магазин: покупка за денежки, без денежек продукт только покачивается', async ({ page }, info) => {
  await withSave(page, { coins: 5 });
  const b = await center(page, 'btn:basket');
  await page.touchscreen.tap(b.x, b.y);
  await expect.poll(() => sceneId(page)).toBe('shop');
  const seeds = await center(page, 'food:seeds');
  await page.touchscreen.tap(seeds.x, seeds.y);
  await expect.poll(async () => (await save(page)).coins).toBe(1);
  expect((await save(page)).basket).toEqual({ seeds: 1 });
  const apple = await center(page, 'food:apple');
  await page.touchscreen.tap(apple.x, apple.y);
  await page.waitForTimeout(300);
  expect((await save(page)).coins).toBe(1);
  expect((await save(page)).basket).toEqual({ seeds: 1 });
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-shop.png` });
});

test('голод и кормление: голодный Пушок, семечки ко рту, сытость растет', async ({ page }, info) => {
  await withSave(page, { satietyValue: 15, basket: { seeds: 1, apple: 2 } });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-hungry-home.png` });
  const t = await center(page, 'obj:table');
  await page.touchscreen.tap(t.x, t.y);
  await expect.poll(() => sceneId(page), { timeout: 8000 }).toBe('feed');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-feed-before.png` });
  // слоты: семечки, яблоко → ширина 2×24+3 = 51, первый слот с x = 61
  const from = await (await piki(page)).evaluate((p) => (p.app as unknown as { toCss(x: number, y: number): { x: number; y: number } }).toCss(73, 93));
  await dragTo(page, from, { x: 97.5, y: 58.5 });
  await expect.poll(async () => (await save(page)).basket).toEqual({ apple: 2 });
  expect((await save(page)).satiety.value).toBeGreaterThan(39);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-feed-eating.png` });
});

test('сытый Пушок вежливо отказывается, еда остается в корзинке', async ({ page }) => {
  await withSave(page, { satietyValue: 100, basket: { apple: 1 } });
  const t = await center(page, 'obj:table');
  await page.touchscreen.tap(t.x, t.y);
  await expect.poll(() => sceneId(page), { timeout: 8000 }).toBe('feed');
  const from = await (await piki(page)).evaluate((p) => (p.app as unknown as { toCss(x: number, y: number): { x: number; y: number } }).toCss(86, 93));
  await dragTo(page, from, { x: 97.5, y: 58.5 });
  await page.waitForTimeout(300);
  expect((await save(page)).basket).toEqual({ apple: 1 });
  const refusals = await (await piki(page)).evaluate((p) => (p.app as unknown as { scene: { refusals: number } }).scene.refusals);
  expect(refusals).toBe(1);
});

// ---------- этап 4: гардероб ----------

test('гардероб: надеть и снять шляпку, надеть гитару, закрытое не надевается', async ({ page }, info) => {
  await withSave(page, { butterfliesTotal: 30, unlocked: { hats: ['crown', 'bow'], guitars: ['pink'] } });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-home-new-unlocks.png` });
  const w = await center(page, 'btn:wardrobe');
  await page.touchscreen.tap(w.x, w.y);
  await expect.poll(() => sceneId(page)).toBe('wardrobe');
  expect((await save(page)).seen.sort()).toEqual(['guitar:pink', 'hat:bow', 'hat:crown']);

  const tap = async (id: string) => {
    const c = await center(page, id);
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForTimeout(150);
  };
  await tap('hat:bow');
  expect((await save(page)).equipped.hat).toBe('bow');
  await tap('hat:crown');
  expect((await save(page)).equipped.hat).toBe('crown');
  await tap('guitar:pink');
  expect((await save(page)).equipped.guitar).toBe('pink');
  await tap('hat:wreath'); // закрыто (50 бабочек)
  expect((await save(page)).equipped.hat).toBe('crown');
  await tap('guitar:blue'); // закрыто (70)
  expect((await save(page)).equipped.guitar).toBe('pink');
  await tap('pushok'); // мелодия
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-wardrobe.png` });
  await tap('hat:crown'); // повторный тап снимает
  expect((await save(page)).equipped.hat).toBeNull();

  // в домике Пушок в гитаре
  await tap('btn:home');
  await expect.poll(() => sceneId(page)).toBe('home');
  expect((await save(page)).equipped.guitar).toBe('pink');
});
