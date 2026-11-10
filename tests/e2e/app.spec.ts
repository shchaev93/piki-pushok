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
  expect(sizes.length).toBeGreaterThanOrEqual(13);
  for (const s of sizes) {
    expect(s.w, s.id).toBeGreaterThanOrEqual(64);
    expect(s.h, s.id).toBeGreaterThanOrEqual(64);
  }
});

test('тап по каждому предмету запускает занятие (скриншоты в процессе)', async ({ page }, info) => {
  await page.goto('./?nohint');
  await ready(page);
  const ids = ['bed', 'climber', 'bath', 'kitchen', 'trampoline', 'table', 'slide', 'rope'];
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
