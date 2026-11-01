import pino from 'pino';
import { config } from './config.js';

// LOG_FILE: write logs straight to a file (Windows installer). Writing to a
// file we own avoids piping stdout through a PowerShell host, where a dying
// host silently takes the server down with it (EPIPE on the next log line).
const logFile = process.env.LOG_FILE;

export const logger = logFile
  ? pino(
      { level: config.nodeEnv === 'development' ? 'debug' : 'info' },
      pino.destination({ dest: logFile, mkdir: true, sync: true, append: true }),
    )
  : pino({
      level: config.nodeEnv === 'development' ? 'debug' : 'info',
      transport: config.nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    });
