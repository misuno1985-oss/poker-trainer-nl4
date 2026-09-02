/**
 * Сохранение файла на диск — целиком в браузере.
 *
 * Никакого сервера: приложение остаётся статикой на GitHub Pages. Наружу
 * уходит ровно то, что передали, и ничего больше — ни localStorage, ни
 * настроек, ни чего-либо ещё со страницы.
 */

export function downloadJson(name: string, data: unknown): void {
  if (typeof document === 'undefined') return;

  // Отступы намеренно: файл должен читаться и человеком, и машиной.
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Отпускаем ссылку не сразу: часть браузеров не успевает начать скачивание.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
