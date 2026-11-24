import { login, logout, register, requireUser } from './auth.js';
import { P1Error } from './db.js';
import { readSavings, settlementRequest } from './settlement-routes.js';
import {
  applyToGroup, approve, createDraft, deleteDraft, editRecruitment, exclude, listGroups, publishGroup,
  readGroup, readInvite, rotateInvite, saveDraft, setRecruitmentOpen, withdraw,
} from './groups.js';

const localAddress = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const localHost = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]+)?$/iu;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;

export function createP1Handler(store, { readJson, send }) {
  return async (request, response, path) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const { method } = request;
    const [resource, id, section, target, action, ...extra] = path.slice('/api/p1/'.length).split('/');
    const reply = (status, body) => send(response, status, body);
    try {
      if (!localAddress.has(request.socket.remoteAddress) || !localHost.test(request.headers.host ?? '')) {
        throw new P1Error(403, 'LOCAL_P1_ONLY');
      }
      if (resource === 'auth' && id && section === undefined && method === 'POST') {
        if (id === 'register') return reply(201, await register(store, await readJson(request)));
        if (id === 'login') return reply(200, await login(store, await readJson(request)));
        if (id === 'logout') {
          logout(store, request);
          return reply(204);
        }
      }
      if (resource === 'savings' && id === undefined && method === 'GET') {
        const { id: userId } = requireUser(store.db, request);
        return reply(200, readSavings(store.db, userId));
      }
      if (resource === 'invites' && id && target === undefined) {
        if (section === undefined && method === 'GET') return reply(200, readInvite(store, id));
        if (section === 'applications' && method === 'POST') {
          const { id: userId } = requireUser(store.db, request);
          return reply(201, applyToGroup(store, id, userId, await readJson(request)));
        }
      }
      if (resource === 'groups' && !extra.length) {
        if (id === undefined && ['GET', 'POST'].includes(method)) {
          const { id: userId } = requireUser(store.db, request);
          if (method === 'POST') return reply(201, createDraft(store, userId, await readJson(request)));
          return reply(200, { groups: listGroups(store.db, userId) });
        }
        if (uuid.test(id ?? '')) {
          const { id: userId } = requireUser(store.db, request);
          if (section === 'settlement') {
            const result = await settlementRequest(store, { id, userId, method, target, action,
              readBody: () => readJson(request) });
            if (result !== null) return reply(200, result);
          }
          if (section === undefined) {
            if (method === 'GET') return reply(200, readGroup(store, id, userId));
            if (method === 'PUT') return reply(200, saveDraft(store, id, userId, await readJson(request)));
            if (method === 'DELETE') {
              deleteDraft(store, id, userId, (await readJson(request))?.revision);
              return reply(204);
            }
          }
          if (target === undefined && method === 'POST') {
            if (section === 'publish') return reply(200, publishGroup(store, id, userId, await readJson(request)));
            if (section === 'close' || section === 'reopen') {
              return reply(200, setRecruitmentOpen(store, id, userId, (await readJson(request))?.revision, section === 'reopen'));
            }
            if (section === 'invite') return reply(201, rotateInvite(store, id, userId));
            if (section === 'withdraw') return reply(200, withdraw(store, id, userId));
          }
          if (target === undefined && section === 'recruitment' && method === 'PATCH') {
            return reply(200, editRecruitment(store, id, userId, await readJson(request)));
          }
          if (section === 'applications' && uuid.test(target ?? '') && method === 'POST') {
            if (action === 'approve') return reply(200, approve(store, id, userId, target));
            if (action === 'exclude') return reply(200, exclude(store, id, userId, target));
          }
        }
      }
      return reply(404, { code: 'NOT_FOUND' });
    } catch (error) {
      if (error instanceof P1Error) return reply(error.status, { code: error.message, fields: error.fields });
      if (error.code === 'ERR_SQLITE_ERROR' && (error.errcode & 0xff) === 5) {
        return reply(503, { code: 'P1_DATABASE_BUSY' });
      }
      throw error;
    }
  };
}
