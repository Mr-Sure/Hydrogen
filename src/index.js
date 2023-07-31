const path = require('node:path');
const fs = require('node:fs');
const Koa = require('koa');
const mime = require('mime');

const { bodyParser } = require("@koa/bodyparser");
const Logger = require('think-logger3');

const cookie = require('cookie');

const build = require('./faas-builder');
const { file } = require('./utils');

const logger = new Logger();

const _symbolReceviedTime = Symbol('request-received.startTime');

const app = new Koa();
app.use(async (ctx, next) => {
  logger.info(`<<< ${ctx.method} ${ctx.url}`);
  ctx[_symbolReceviedTime] = Date.now();
  await next();
});
app.use(bodyParser());

process.env.AC_APP_ID = process.env.AC_APP_ID || 'aircode-mock';
process.env.AC_MEMORY_SIZE = process.env.AC_MEMORY_SIZE || '1024';
process.env.AC_EXECUTION_TIMEOUT =process.env.AC_EXECUTION_TIMEOUT || 60;
process.env.AC_DEPLOYMENT_VERSION = -1;
process.env.AC_REGION = process.env.AC_REGION || 'local';
process.env.AC_NODE_JS_VERSION = process.version.match(/^v(\d+\.\d+)/)[1];
process.env.AC_FAAS_ROOT = process.env.AC_FAAS_ROOT || 'src';

build(process.env.AC_FAAS_ROOT);

const moduleAlias = require('module-alias');
moduleAlias.addAliases({
  'aircode': path.resolve(__dirname, 'runtime'),
});

require('aircode'); // for cache

function requireModule(faasname) {
  let module = faasname;
  if(!require.cache[module]) {
    module = `${faasname}.js`;
  }
  if(!require.cache[module]) {
    module = `${faasname}.cjs`;
  }
  try {
    module = require(module);
    if(typeof module !== 'function' && typeof module.default === 'function') {
      module = module.default;
    }
    return module;
  } catch (ex) {
    return null;
  }
}

// response
app.use(async (ctx, next) => {
  const {method} = ctx.request;
  const params = method === 'GET' ? ctx.request.query : ctx.request.body;
  const context = {
    headers: ctx.request.headers,
    method,
    query: ctx.request.query,
    tirgger: 'HTTP',
    set: (field, value) => ctx.set(field, value),
    remove: (field) => ctx.remove(field),
    status: (code) => {
      if(code) ctx.response.status = code;
      return ctx.response.status;
    },
    cookie: (name, value, options) => {
      ctx.cookies.set(name, value, options);
    },
    clearCookie: (name) => {
      ctx.cookies.set(name, '', { expires: new Date(1) });
    },
    url: ctx.request.url,
    path: ctx.request.path,
    host: ctx.request.host,
    protocal: ctx.protocol,
    req: ctx.request,
    res: ctx.response,
    cookies: cookie.parse(ctx.request.headers.cookie || ''),
  };
  const faas = ctx.request.path.slice(1) || 'index';
  // console.log(faas);
  if(faas && !faas.startsWith('.')) {
    const faasname = file(faas);
    try {
      let module = requireModule(faasname);
      if(typeof module !== 'function' && typeof module.default === 'function') {
        module = module.default;
      }
      if(typeof module === 'function') {
        try {
          ctx.body = await module(params, context);
        } catch(ex) {
          logger.error(ex);
        }
      }
    } catch (ex) {
      // do nothing
    }
  } else if(faas.startsWith('.files/')) {
    const filepath = file(faas);
    // console.log(filepath);
    if(fs.existsSync(filepath)) {
      const filestream = fs.createReadStream(filepath);
      // const filename = path.basename(filepath);
      // ctx.set('Content-disposition', 'attachment; filename=' + filename);
      const mimetype = mime.getType(filepath);
      ctx.set('Content-type', mimetype);
      ctx.body = filestream;
    } else {
      ctx.body = '404 Not Found File.';
    }
  } else {
    ctx.body = '404 Not Found.';
  }
  await next();
});

app.use(async (ctx) => {
  logger.info(`>>> ${ctx.method} ${ctx.url} ${ctx.response.status} ${Date.now() - ctx[_symbolReceviedTime]}ms`);
});

function start(port = process.env.AC_PORT || 3000) {
  app.listen(port);
  app.PORT = port;
  logger.info(`Server running at http://127.0.0.1:${port}`);
  logger.info(`Public root: `);
  logger.info(`FaaS root: ${process.env.AC_FAAS_ROOT}`);
  return app;
}

module.exports = {
  start,
  file,
};
