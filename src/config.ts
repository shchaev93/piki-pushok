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
    recipes: [
      { dish: 'pie', ingredients: ['apple', 'seeds'] as FoodId[] },
      { dish: 'sandwich', ingredients: ['bread', 'cheese'] as FoodId[] },
      { dish: 'salad', ingredients: ['apple', 'carrot'] as FoodId[] },
    ],
    /** Сколько полных кругов помешать, чтобы блюдо сварилось. */
    stirTurns: 2,
  },

  /**
   * Ночь: наступает дома, если раунд облачка долетели до конца (до ночного неба).
   * Длится nightMinutes реального времени, потом утро. Небо в раунде:
   * день → закат (sunsetFrom) → вечер (eveningFrom) → ночь (nightFrom), доли раунда.
   */
  night: {
    nightMinutes: 20,
    sunsetFrom: 0.55,
    eveningFrom: 0.75,
    nightFrom: 0.88,
    /** Как часто ночью Пушок зевает, намекая на кроватку, мс. */
    yawnEveryMs: 6000,
  },

  cloud: {
    roundSeconds: 60,
    coinsPerButterfly: 1,
    /** Пауза между бабочками, мс. За раунд пролетает ~18, ловится обычно 10-15. */
    butterflyEveryMs: [2400, 3800] as [number, number],
    butterflySpeed: [20, 30] as [number, number],
    appleEveryMs: [9000, 14000] as [number, number],
    appleSpeed: 16,
    /** Насколько плавно облачко догоняет палец (больше = резче). */
    follow: 9,
  },

  /** Шляпки и гитары. Порог = общее число пойманных бабочек. */
  hats: [
    { id: 'crown', unlockAt: 5, approved: true },
    { id: 'star', unlockAt: 12, approved: false },
    { id: 'bow', unlockAt: 25, approved: false },
    { id: 'flower', unlockAt: 35, approved: false },
    { id: 'wreath', unlockAt: 50, approved: false },
    { id: 'cap', unlockAt: 70, approved: false },
    { id: 'pompom', unlockAt: 90, approved: false },
    { id: 'bunny', unlockAt: 115, approved: false },
    { id: 'cherry', unlockAt: 140, approved: false },
    { id: 'party', unlockAt: 170, approved: false },
    { id: 'heart', unlockAt: 200, approved: false },
    { id: 'rainbow', unlockAt: 250, approved: false },
  ],
  /** Кофточки: розовая с сердечком, голубая в полоску, желтая в горошек,
   *  зеленая со звездочкой, сиреневая с зигзагом, радужная. */
  sweaters: [
    { id: 'heart', unlockAt: 8 },
    { id: 'stripes', unlockAt: 30 },
    { id: 'dots', unlockAt: 60 },
    { id: 'star', unlockAt: 100 },
    { id: 'zigzag', unlockAt: 150 },
    { id: 'rainbow', unlockAt: 220 },
  ],
  guitars: [
    { id: 'pink', unlockAt: 15 },
    { id: 'green', unlockAt: 40 },
    { id: 'blue', unlockAt: 70 },
    { id: 'lilac', unlockAt: 110 },
    { id: 'gold', unlockAt: 170 },
    { id: 'rainbow', unlockAt: 240 },
  ],
} as const;

export type ActivityId = keyof typeof CONFIG.activityMs;
