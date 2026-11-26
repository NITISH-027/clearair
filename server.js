/**
 * Process entry point: reads PORT and starts the HTTP server.
 */
import { DEFAULT_PORT } from './server/config.js';
import { createServer } from './server/app.js';
import { logger } from './server/logger.js';

const port = Number(process.env.PORT) || DEFAULT_PORT;
createServer().listen(port, () => logger.info('listening', { port }));
