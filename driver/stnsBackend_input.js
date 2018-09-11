let param = {};
exports.INPUT = param;

// We will put dummy objects for event and context;
param.event = {
  resource: '/{proxy+}',
  // path: '/healthcheck',
  // path: '/user/id/10014',
  path: '/user/list',
  // path: '/group/id/10001',
  // path: '/group/list',
  httpMethod: 'GET',
  headers: {
    Authorization: 'Basic dGVzdDE6ZHVtbXk=',
  },
  body: null,
};

param.context = {

  // InvokeID may be unique invocation id for AWS Lambda.
  invokeid: 'string',

  // context.done() should be called for end of each invocation.
  // We would want to stub this.
  done: function(err, data) {
    console.log(data);
    return;
  },
};

param.callback = function(err, data) {
  if (err) console.log('NG: ' + JSON.stringify(err, null, 2));
  else console.log('OK: ' + JSON.stringify(data, null, 2));
};
