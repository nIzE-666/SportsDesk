import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Собирает обзор экранов для README: шесть снимков каждой темы по 2,5 секунды,
 * бесконечный цикл, APNG с расширением .png.
 *
 * ffmpeg не входит в зависимости проекта: скрипт пользуется установленным
 * ffmpeg и останавливается с понятным сообщением, если его нет.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'docs', 'readme');
const FRAMES = ['today', 'match', 'tournament', 'club', 'f1', 'my'];
const THEMES = ['light', 'dark'];
const FRAME_SECONDS = 2.5;
const MAX_BYTES = 4 * 1024 * 1024;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true });
if (ffmpeg.error?.code === 'ENOENT')
  fail('ffmpeg не найден: установите ffmpeg и повторите запуск.');
if (ffmpeg.status !== 0)
  fail('ffmpeg не запустился: проверьте установку ffmpeg и повторите запуск.');

const missing = THEMES.flatMap((theme) =>
  FRAMES.map((frame) => `${frame}-${theme}.png`).filter((file) => !existsSync(join(shots, file))),
);
if (missing.length) fail(`Не хватает снимков в docs/readme: ${missing.join(', ')}.`);

const temp = mkdtempSync(join(tmpdir(), 'sportsdesk-readme-'));
try {
  for (const theme of THEMES) {
    const list = join(temp, `tour-${theme}.txt`);
    const lines = ['ffconcat version 1.0'];
    for (const frame of FRAMES) {
      const source = join(shots, `${frame}-${theme}.png`);
      const png = readFileSync(source);
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      if (width !== 1280 || height > 800)
        fail(`${source}: ожидается ширина 1280 и высота не больше 800.`);
      let file = source;
      if (height < 800) {
        // Обрезанный кадр дополняем фоном снизу, чтобы все кадры были 1280×800.
        const pixel = spawnSync(
          'ffmpeg',
          [
            '-v',
            'error',
            '-i',
            source,
            '-vf',
            `crop=1:1:640:${height - 1}`,
            '-f',
            'rawvideo',
            '-pix_fmt',
            'rgb24',
            '-',
          ],
          { windowsHide: true },
        );
        if (pixel.status !== 0 || pixel.stdout.length < 3)
          fail(`${source}: не удалось прочитать цвет фона для дополнения кадра.`);
        const color = `0x${[...pixel.stdout.subarray(0, 3)]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('')}`;
        const padded = join(temp, `${frame}-${theme}.png`);
        const padding = spawnSync(
          'ffmpeg',
          [
            '-y',
            '-loglevel',
            'error',
            '-i',
            source,
            '-vf',
            `pad=1280:800:0:0:color=${color}`,
            '-frames:v',
            '1',
            padded,
          ],
          { stdio: 'inherit', windowsHide: true },
        );
        if (padding.status !== 0) fail(`${source}: не удалось дополнить кадр до 1280×800.`);
        file = padded;
        console.log(`${source}: ${height} px high, padded to 800 with ${color}.`);
      }
      lines.push(`file '${file.replace(/\\/g, '/')}'`, `duration ${FRAME_SECONDS}`);
    }
    writeFileSync(list, `${lines.join('\n')}\n`, 'utf8');
    const output = join(shots, `tour-${theme}.png`);
    const result = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-f',
        'apng',
        '-plays',
        '0',
        '-pix_fmt',
        'rgb24',
        output,
      ],
      { stdio: 'inherit', windowsHide: true },
    );
    if (result.status !== 0) fail(`ffmpeg не собрал ${output}.`);
    let size = statSync(output).size;
    if (size >= MAX_BYTES) {
      // На будущее: снимки уже сжаты, поэтому сначала уменьшаем глубину цвета.
      const reduced = spawnSync(
        'ffmpeg',
        [
          '-y',
          '-loglevel',
          'error',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          list,
          '-f',
          'apng',
          '-plays',
          '0',
          '-pix_fmt',
          'pal8',
          output,
        ],
        { stdio: 'inherit', windowsHide: true },
      );
      if (reduced.status !== 0) fail(`ffmpeg не собрал ${output} с меньшей глубиной цвета.`);
      size = statSync(output).size;
      if (size >= MAX_BYTES)
        fail(`${output} больше 4 МБ: уменьшите глубину цвета или число кадров.`);
      console.log(`${output}: цвет снижен до палитры, чтобы уложиться в 4 МБ.`);
    }
    // Проверяем, что ffmpeg записал именно бесконечный APNG.
    const png = readFileSync(output);
    const animation = png.indexOf('acTL');
    const plays = animation < 0 ? -1 : png.readUInt32BE(animation + 8);
    if (plays !== 0) fail(`${output}: не удалось включить бесконечный цикл.`);
    console.log(
      `${output}: ${FRAMES.length} кадров по ${FRAME_SECONDS} с, ${(size / 1024).toFixed(0)} КБ.`,
    );
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
