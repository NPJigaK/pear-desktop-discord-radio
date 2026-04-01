import pino, { type Logger } from 'pino';

export interface RuntimeLogger {
  child(bindings: Readonly<Record<string, unknown>>): RuntimeLogger;
  info(message: string, payload?: Readonly<Record<string, unknown>>): void;
  warn(message: string, payload?: Readonly<Record<string, unknown>>): void;
  error(message: string, payload?: Readonly<Record<string, unknown>>): void;
  debug(message: string, payload?: Readonly<Record<string, unknown>>): void;
}

function wrapLogger(logger: Logger): RuntimeLogger {
  const write =
    (method: 'info' | 'warn' | 'error' | 'debug') =>
      (message: string, payload?: Readonly<Record<string, unknown>>) => {
        if (payload === undefined) {
          logger[method](message);
          return;
        }

        logger[method](payload, message);
      };

  return {
    child(bindings) {
      return wrapLogger(logger.child(bindings));
    },
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    debug: write('debug'),
  };
}

export function createLogger(level = 'info'): RuntimeLogger {
  return wrapLogger(
    pino({
      level,
      base: null,
    }),
  );
}
