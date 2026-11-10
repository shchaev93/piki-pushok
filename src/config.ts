// Все игровые числа в одном месте. Их будут подбирать по наблюдениям,
// поэтому код не должен хранить эти значения нигде, кроме этого файла.

export type FoodId = 'seeds' | 'apple' | 'carrot' | 'cheese' | 'bread';

export const CONFIG = {
  /** Логическая сцена домика в пикселях спрайтов. Масштаб на экране всегда целый. */
  scene: { width: 192, height: 108 },

  /** Минимальная цель касания в CSS px (требование ТЗ). */
  minTouchCssPx: 64,

  /** Удержание шестеренки и кнопки сброса в панели взрослых. */
  adultHoldMs: 3000,

  pushok: {
    /** Скорость перемещения прыжками, логических px в секунду. */
    hopSpeed: 64,
    /** Длительность одного прыжка при ходьбе, мс. */
    hopMs: 320,
    hopHeight: 3,
    blinkEveryMs: [2500, 5500] as [number, number],
    blinkMs: 140,
  },

  /** Длительность занятий в домике, мс (ТЗ: 2-4 секунды). */
  activityMs: {
    bed: 4000,
    table: 3000,
    bath: 3500,
    toilet: 2800,
    trampoline: 3200,
    slide: 3200,
    climber: 3600,
    rope: 3200,
    kitchen: 2600,
  },

  // ---- Ниже параметры следующих этапов. Схема сохранения уже их учитывает. ----

  hunger: {
    max: 100,
    floor: 10,
    /** Ниже этого порога над головой мысль-облачко с семечкой. */
    hungryBelow: 40,
    /** Ниже этого порога Пушок грустит и двигается медленнее. */
    veryHungryBelow: 20,
    /** От полной сытости до «просит кушать». Скорость = (max - hungryBelow) / hours. */
    hoursFullToHungry: 6,
    veryHungrySpeedFactor: 0.6,
    /** Яблочко, пойманное на облачке, съедается сразу. */
    cloudApple: 15,
  },

  food: {
    seeds: { price: 4, satiety: 25, favorite: true },
    apple: { price: 3, satiety: 15, favorite: false },
    carrot: { price: 2, satiety: 12, favorite: false },
    cheese: { price: 3, satiety: 18, favorite: false },
    bread: { price: 2, satiety: 12, favorite: false },
  } satisfies Record<FoodId, { price: number; satiety: number; favorite: boolean }>,

  kitchen: {
    minIngredients: 2,
    maxIngredients: 3,
    /** Сытость блюда = сумма ингредиентов × multiplier, но не меньше min. */
    dishMultiplier: 1.3,
    dishMin: 35,
    /** Особые блюда. Порядок ингредиентов не важен. Остальное = суп-сюрприз. */
    recipes: [{ dish: 'pie', ingredients: ['apple', 'seeds'] as FoodId[] }],
  },

  cloud: {
    roundSeconds: 60,
    coinsPerButterfly: 1,
  },

  /** Шляпки и гитары. Порог = общее число пойманных бабочек. */
  hats: [
    { id: 'crown', unlockAt: 5, approved: true },
    { id: 'bow', unlockAt: 25, approved: false },
    { id: 'wreath', unlockAt: 50, approved: false },
    { id: 'pompom', unlockAt: 90, approved: false },
    { id: 'cherry', unlockAt: 140, approved: false },
    { id: 'heart', unlockAt: 200, approved: false },
  ],
  guitars: [
    { id: 'pink', unlockAt: 15 },
    { id: 'blue', unlockAt: 70 },
    { id: 'gold', unlockAt: 170 },
  ],
} as const;

export type ActivityId = keyof typeof CONFIG.activityMs;
