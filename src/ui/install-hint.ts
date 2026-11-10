import { isIOS, isStandalone } from './platform';

// Экран для взрослых при открытии во вкладке браузера: как установить игру.
// Во вкладке Safari данные могут стереться, поэтому играть нужно с иконки.

const SKIP_KEY = 'piki-pushok.hint-skipped';

export function maybeShowInstallHint(): void {
  if (isStandalone()) return;
  if (new URLSearchParams(location.search).has('nohint')) return;
  try {
    if (sessionStorage.getItem(SKIP_KEY)) return;
  } catch {
    /* приватный режим */
  }

  const root = document.createElement('div');
  root.className = 'overlay hint';
  const ios = isIOS();
  root.innerHTML = `
    <div class="panel">
      <h2>Пики Пушок</h2>
      <p>Для взрослых: установите игру на экран «Домой» и запускайте ее с иконки. Так она работает без интернета, а прогресс не пропадет.</p>
      <ol class="${ios ? 'current' : ''}">
        <li><b>iPhone, iPad:</b> откройте ссылку в Safari → кнопка «Поделиться» → «На экран Домой».</li>
      </ol>
      <ol class="${ios ? '' : 'current'}">
        <li><b>Android:</b> откройте ссылку в Chrome → меню ⋮ → «Установить приложение» (или «Добавить на главный экран»).</li>
      </ol>
      <p class="warn">Прогресс во вкладке браузера и в установленной игре хранится отдельно.</p>
      <button class="btn primary" type="button">Играть в браузере</button>
    </div>`;
  root.querySelector('button')!.addEventListener('click', () => {
    try {
      sessionStorage.setItem(SKIP_KEY, '1');
    } catch {
      /* ничего */
    }
    root.remove();
  });
  document.body.append(root);
}
