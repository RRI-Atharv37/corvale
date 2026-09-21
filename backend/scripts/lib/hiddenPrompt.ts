const CTRL_C = String.fromCharCode(3)
const DELETE = String.fromCharCode(127)
const BACKSPACE = String.fromCharCode(8)

/**
 * Reads a secret from an interactive terminal without echoing it. Deliberately refuses piped input: the
 * bootstrap and break-glass secrets must never travel through argv, environment, shell history or a file.
 */
export const promptHidden = (question: string): Promise<string> =>
    new Promise((resolve, reject) => {
        const { stdin, stdout } = process
        if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
            reject(new Error('This command must be run in an interactive terminal; the secret cannot be piped in.'))
            return
        }

        let value = ''
        stdout.write(question)
        stdin.setRawMode(true)
        stdin.resume()
        stdin.setEncoding('utf8')

        const finish = (): void => {
            stdin.setRawMode(false)
            stdin.pause()
            stdin.removeListener('data', onData)
            stdout.write('\n')
        }

        const onData = (chunk: string): void => {
            for (const char of chunk) {
                if (char === '\r' || char === '\n') {
                    finish()
                    resolve(value)
                    return
                }
                if (char === CTRL_C) {
                    finish()
                    reject(new Error('Cancelled'))
                    return
                }
                if (char === DELETE || char === BACKSPACE) value = value.slice(0, -1)
                else value += char
            }
        }

        stdin.on('data', onData)
    })

export const readFlag = (name: string): string | undefined => {
    const index = process.argv.indexOf(`--${name}`)
    return index !== -1 ? process.argv[index + 1] : undefined
}
