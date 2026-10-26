export type ApiErrorCode =
  | 'UnknownSource'
  | 'InvalidPath'
  | 'MissingKey'
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
  InvalidPath: 'Недопустимый путь запроса.',
  MissingKey: 'Ключ PitchAPI не настроен. Добавьте ключ в настройках.',
  Unauthorized: 'Провайдер отклонил доступ. Проверьте ключ или сессию.',
  NotFound: 'Запрошенные данные не найдены у провайдера.',
  RateLimited: 'Провайдер ограничил запросы. Попробуйте позже.',
  Timeout: 'Провайдер не ответил вовремя.',
  TooLarge: 'Ответ провайдера слишком большой.',
  BadPayload: 'Провайдер вернул некорректные данные.',
  Upstream: 'Данные провайдера временно недоступны.',
  Cache: 'Внутренняя ошибка кеша.',
  Config: 'Некорректная конфигурация источника.',
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
