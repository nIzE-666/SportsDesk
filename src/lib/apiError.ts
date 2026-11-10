export type ApiErrorCode =
  | 'UnknownSource'
  | 'InvalidPath'
  | 'MissingKey'
  | 'KeyUnreadable'
  | 'Unauthorized'
  | 'NotFound'
  | 'RateLimited'
  | 'Timeout'
  | 'TooLarge'
  | 'BadPayload'
  | 'Upstream'
  | 'Cache'
  | 'Config';
export interface ApiFailure {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
}
const MESSAGES: Record<ApiErrorCode, string> = {
  UnknownSource: 'Неизвестный источник данных.',
  InvalidPath: 'Некорректный запрос.',
  MissingKey: 'Ключ PitchAPI не настроен. Добавьте ключ в настройках.',
  KeyUnreadable:
    'Сохранённый ключ PitchAPI не удалось прочитать или расшифровать. Введите ключ заново в настройках под текущей учётной записью Windows.',
  Unauthorized: 'Источник отклонил доступ. Проверьте ключ или вход.',
  NotFound: 'Запрошенные данные не найдены в источнике.',
  RateLimited: 'Источник ограничил запросы. Попробуйте позже.',
  Timeout: 'Источник не ответил вовремя.',
  TooLarge: 'Ответ источника слишком большой.',
  BadPayload: 'Источник вернул некорректные данные.',
  Upstream: 'Данные источника временно недоступны.',
  Cache: 'Не удалось прочитать сохранённые данные.',
  Config: 'Источник настроен неверно.',
};
export class ApiError extends Error implements ApiFailure {
  readonly retryable: boolean;
  constructor(
    public readonly code: ApiErrorCode,
    message = MESSAGES[code],
  ) {
    super(message);
    this.name = 'ApiError';
    this.retryable = ['Timeout', 'RateLimited', 'Upstream'].includes(code);
  }
}
export function toApiFailure(error: unknown): ApiFailure {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    Object.hasOwn(MESSAGES, error.code)
  ) {
    const code = error.code as ApiErrorCode;
    const message =
      'message' in error && typeof error.message === 'string'
        ? error.message.slice(0, 1024)
        : MESSAGES[code];
    return { code, message, retryable: ['Timeout', 'RateLimited', 'Upstream'].includes(code) };
  }
  return {
    code: 'Upstream',
    message:
      error instanceof Error
        ? error.message.slice(0, 1024)
        : typeof error === 'string'
          ? error.slice(0, 1024)
          : MESSAGES.Upstream,
    retryable: true,
  };
}
export function asApiError(error: unknown): ApiError {
  const failure = toApiFailure(error);
  return new ApiError(failure.code, failure.message);
}
