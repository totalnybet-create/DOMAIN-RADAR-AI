export type ExecutorProvider = "native" | "replit" | "appdeploy" | "yepcode";

export type ExecutorFailureCode =
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "TASK_FAILED"
  | "SECURITY_BLOCK"
  | "HUMAN_ACTION_REQUIRED";

export class ExecutorFailure extends Error {
  readonly code: ExecutorFailureCode;
  readonly retryNextProvider: boolean;

  constructor(
    code: ExecutorFailureCode,
    message: string,
    options: { retryNextProvider?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ExecutorFailure";
    this.code = code;
    this.retryNextProvider = options.retryNextProvider ?? true;
  }
}

export type ExecutorAttempt = {
  provider: ExecutorProvider;
  ok: boolean;
  durationMs: number;
  failureCode?: ExecutorFailureCode;
  error?: string;
};

export type ExecutorAdapter<Input, Output> = {
  provider: ExecutorProvider;
  isAvailable: () => boolean | Promise<boolean>;
  execute: (input: Input, signal: AbortSignal) => Promise<Output>;
};

export type RunExecutorOptions<Input, Output> = {
  task: string;
  input: Input;
  adapters: ExecutorAdapter<Input, Output>[];
  timeoutMs?: number;
};

export type ExecutorResult<Output> = {
  task: string;
  provider: ExecutorProvider;
  output: Output;
  attempts: ExecutorAttempt[];
};

function safeMessage(error: unknown) {
  if (error instanceof ExecutorFailure) return error.message;
  if (error instanceof Error) return error.message.slice(0, 240);
  return "Unknown executor failure";
}

function normalizeFailure(error: unknown): ExecutorFailure {
  if (error instanceof ExecutorFailure) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ExecutorFailure("TIMEOUT", "Executor attempt timed out.");
  }
  return new ExecutorFailure("TASK_FAILED", safeMessage(error), { cause: error });
}

export async function runWithExecutorFallback<Input, Output>(
  options: RunExecutorOptions<Input, Output>,
): Promise<ExecutorResult<Output>> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 45_000);
  const attempts: ExecutorAttempt[] = [];

  if (!options.adapters.length) {
    throw new ExecutorFailure("PROVIDER_UNAVAILABLE", "No executor adapters were registered.", {
      retryNextProvider: false,
    });
  }

  for (const adapter of options.adapters) {
    const startedAt = Date.now();

    let available = false;
    try {
      available = await adapter.isAvailable();
    } catch {
      available = false;
    }

    if (!available) {
      attempts.push({
        provider: adapter.provider,
        ok: false,
        durationMs: Date.now() - startedAt,
        failureCode: "PROVIDER_UNAVAILABLE",
        error: "Provider is not configured or unavailable.",
      });
      continue;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const output = await adapter.execute(options.input, controller.signal);
      attempts.push({
        provider: adapter.provider,
        ok: true,
        durationMs: Date.now() - startedAt,
      });
      return { task: options.task, provider: adapter.provider, output, attempts };
    } catch (error) {
      const failure = normalizeFailure(error);
      attempts.push({
        provider: adapter.provider,
        ok: false,
        durationMs: Date.now() - startedAt,
        failureCode: failure.code,
        error: safeMessage(failure),
      });

      if (!failure.retryNextProvider || failure.code === "HUMAN_ACTION_REQUIRED") {
        throw new ExecutorFailure(failure.code, failure.message, {
          retryNextProvider: false,
          cause: failure,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const summary = attempts
    .map((attempt) => `${attempt.provider}:${attempt.failureCode ?? "failed"}`)
    .join(", ");

  throw new ExecutorFailure(
    "PROVIDER_UNAVAILABLE",
    `All executor providers failed or were unavailable (${summary}).`,
    { retryNextProvider: false },
  );
}
