const { randomInt } = require('node:crypto');
const lifecycle = require('./wisStockOrderLifecycle.mjs');
// Server-only delay draw. Sample once per logical new order before retryable
// transaction work. Never export this wrapper to a browser or a student RPC.
const createWisStockOrderDelaySeconds = () => randomInt(5, 61);
module.exports = { ...lifecycle, createWisStockOrderDelaySeconds };
