export type LogLevel = 'info' | 'warn' | 'error'
export type LogWriter = (line: string) => void

let testWriter: LogWriter | null = null

/** Test-only hook to capture emitted log lines instead of writing to real stdout/stderr. */
export const setLoggerWriter = (writer: LogWriter | null): void => {
    testWriter = writer
}

const write = (level: LogLevel, line: string): void => {
    if (testWriter) {
        testWriter(line)
        return
    }
    const stream = level === 'error' ? process.stderr : process.stdout
    stream.write(line + '\n')
}

const emit = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    write(
        level,
        JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            message,
            ...meta,
        })
    )
}

export const logger = {
    info: (message: string, meta?: Record<string, unknown>): void => emit('info', message, meta),
    warn: (message: string, meta?: Record<string, unknown>): void => emit('warn', message, meta),
    error: (message: string, meta?: Record<string, unknown>): void => emit('error', message, meta),
}
