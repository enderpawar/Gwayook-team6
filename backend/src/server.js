import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { analyze, validateOptions, validateProduct } from './analysis.js';
import { createExtractionGuard } from './extraction-guard.js';
import { extractProduct } from './gemini.js';
import { presets } from './presets.js';
import { openP1Database } from './p1/db.js';
import { createP1Handler } from './p1/routes.js';

const bodyLimit = 16 * 1024;
const imageLimit = 5 * 1024 * 1024;
const multipartLimit = imageLimit + bodyLimit;

class RequestError extends Error {
  constructor(status, code, fields, reason) {
    super(code);
    this.status = status;
    this.fields = fields;
    this.reason = reason;
  }
}

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readBody(request, limit) {
  if (Number(request.headers['content-length']) > limit) throw new RequestError(413, 'BODY_TOO_LARGE');
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) throw new RequestError(413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length);
}

async function readJson(request) {
  const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new RequestError(415, 'EXPECTED_JSON');
  const bytes = await readBody(request, bodyLimit);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new RequestError(400, 'INVALID_JSON');
  }
}

function supportedImage(bytes, type) {
  switch (type) {
    case 'image/jpeg': return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/png': return bytes.length > 8 && bytes.readBigUInt64BE(0) === 0x89504e470d0a1a0an;
    case 'image/webp': return bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF'
      && bytes.toString('ascii', 8, 12) === 'WEBP';
    default: return false;
  }
}

async function readImage(request) {
  const contentType = request.headers['content-type'];
  if (contentType?.split(';', 1)[0].trim().toLowerCase() !== 'multipart/form-data') {
    throw new RequestError(415, 'EXPECTED_MULTIPART');
  }
  const bytes = await readBody(request, multipartLimit);
  let form;
  try {
    form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData();
  } catch {
    throw new RequestError(400, 'INVALID_MULTIPART');
  }
  const image = form.get('image');
  if (!(image instanceof File) || form.getAll('image').length !== 1) {
    throw new RequestError(400, 'EXPECTED_ONE_IMAGE', ['image']);
  }
  if (image.size > imageLimit) throw new RequestError(413, 'BODY_TOO_LARGE');
  for (const [name, value] of form) {
    if (name !== 'image' && value instanceof File) {
      throw new RequestError(400, 'EXPECTED_ONE_IMAGE', ['image']);
    }
  }
  const data = Buffer.from(await image.arrayBuffer());
  if (!supportedImage(data, image.type)) throw new RequestError(415, 'UNSUPPORTED_IMAGE', ['image']);

  return { mimeType: image.type, data };
}

export function createApp({ p1DbPath = process.env.P1_DB_PATH, extract = extractProduct } = {}) {
  const extractionGuard = createExtractionGuard({ extract });
  const store = p1DbPath ? openP1Database(p1DbPath) : null;
  const handleP1 = store && createP1Handler(store, { readJson, send });
  const server = createServer(async (request, response) => {
    const path = request.url?.split('?', 1)[0];
    try {
      if (handleP1 && path?.startsWith('/api/p1/')) return await handleP1(request, response, path);
      if (path === '/api/presets' && request.method === 'GET') {
        return send(response, 200, { presets });
      }
      if (path === '/api/analyses' && request.method === 'POST') {
        const input = await readJson(request);
        const { product, fields } = validateProduct(input?.product);
        const options = validateOptions(input);
        fields.push(...options.fields);
        if (!fields.length && product.bulkTotalQty / product.allocationStep < options.people) {
          throw new RequestError(422, 'INVALID_ANALYSIS_INPUT', ['product.bulkTotalQty'], 'INSUFFICIENT_ALLOCATION_UNITS');
        }
        if (fields.length) throw new RequestError(422, 'INVALID_ANALYSIS_INPUT', fields);
        return send(response, 200, analyze(product, input.product, options));
      }
      if (path === '/api/products/extract' && request.method === 'POST') {
        const image = await readImage(request);
        const { status, retryAfter, ...body } = await extractionGuard.run({
          callerId: request.socket.remoteAddress, ...image,
        });
        if (retryAfter !== undefined) response.setHeader('Retry-After', retryAfter);
        return send(response, status, body);
      }
      return send(response, 404, { code: 'NOT_FOUND' });
    } catch (error) {
      if (response.destroyed) return;
      if (error instanceof RequestError) {
        if (error.status === 413) response.setHeader('Connection', 'close');
        return send(response, error.status, { code: error.message, fields: error.fields, reason: error.reason });
      }
      console.error('Unhandled request error', error);
      return send(response, 500, { code: 'INTERNAL_ERROR' });
    }
  });
  if (store) server.once('close', store.close);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST ?? '127.0.0.1';
  if (process.env.P1_DB_PATH && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('P1_DB_PATH requires a loopback HOST');
  }
  const port = Number(process.env.PORT ?? 3001);
  const server = createApp();
  server.listen(port, host, () => console.log(`GigSplitter API listening on ${host}:${server.address().port}`));
}
