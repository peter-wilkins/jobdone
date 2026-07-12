import { createApp } from '../src/app.js';

export const config = {
  maxDuration: 120,
};

const app = createApp();
let readyPromise;

export default async function handler(req, res) {
  try {
    readyPromise ??= app.ready();
    await readyPromise;
    app.server.emit('request', req, res);
  } catch (error) {
    app.log.error(error);
    res.statusCode = 500;
    res.end('Internal server error');
  }
}
