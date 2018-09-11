let input = require('./stnsBackend_input').INPUT;
let lambda = require('../stnsBackend');
lambda.handler(input.event, input.context, input.callback);
