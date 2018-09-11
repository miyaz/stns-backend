let funcName = 'stnsBackend';
let descStr = 'published on [' + (new Date().toLocaleString()) + ']';

/* eslint node/exports-style: ["error", "module.exports"] */
module.exports = {
  region: 'ap-northeast-1',
  handler: 'stnsBackend.handler',
  functionName: funcName,
  description: descStr,
  timeout: 15,
  memorySize: 128,
  publish: true,
  runtime: 'nodejs8.10',
};

