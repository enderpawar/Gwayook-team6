import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { analyze, validateOptions, validateProduct } from './analysis.js';
import { extractProduct } from './gemini.js';
import { presets } from './presets.js';

const bodyLimit = 16 * 1024;
const imageLimit = 5 * 1024 * 1024;
const multipartLimit = imageLimit + bodyLimit;

class RequestError extends Error {
  constructor(status, code, fields) {
    super(code);
    this.status = status;
    this.fields = fields;
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
  const data = Buffer.from(await image.arrayBuffer());
  if (!supportedImage(data, image.type)) throw new RequestError(415, 'UNSUPPORTED_IMAGE', ['image']);

  const rawPeople = form.get('people');
  const people = typeof rawPeople === 'string' && /^[2-4]$/.test(rawPeople.trim()) ? Number(rawPeople) : undefined;
  const options = validateOptions({ people, location: form.get('location') ?? undefined });
  if (options.fields.length) throw new RequestError(422, 'INVALID_ANALYSIS_INPUT', options.fields);
  return { mimeType: image.type, data, ...options };
}

export function createApp() {
  return createServer(async (request, response) => {
    const path = request.url?.split('?', 1)[0];
    try {
      if (path === '/api/presets' && request.method === 'GET') {
        return send(response, 200, { presets });
      }
      if (path === '/api/analyses' && request.method === 'POST') {
        const input = await readJson(request);
        const { product, fields } = validateProduct(input?.product);
        const options = validateOptions(input);
        fields.push(...options.fields);
        if (product.bulkTotalQty !== undefined && !options.fields.includes('people')
          && product.bulkTotalQty < options.people) fields.push('bulkTotalQty');
        if (fields.length) throw new RequestError(422, 'INVALID_ANALYSIS_INPUT', fields);
        return send(response, 200, analyze(product, options.people, options.location));
      }
      if (path === '/api/products/extract' && request.method === 'POST') {
        const { status, ...body } = await extractProduct(await readImage(request));
        return send(response, status, body);
      }
      return send(response, 404, { code: 'NOT_FOUND' });
    } catch (error) {
      if (response.destroyed) return;
      if (error instanceof RequestError) {
        if (error.status === 413) response.setHeader('Connection', 'close');
        return send(response, error.status, { code: error.message, fields: error.fields });
      }
      console.error('Unhandled request error', error);
      return send(response, 500, { code: 'INTERNAL_ERROR' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3001);
  const server = createApp();
  server.listen(port, host, () => console.log(`GigSplitter API listening on ${host}:${server.address().port}`));
}
