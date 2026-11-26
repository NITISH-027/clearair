import { createServer } from './server/app.js';

const port = Number(process.env.PORT) || 8080;
createServer().listen(port, () => console.log(`ClearAir listening on :${port}`));
