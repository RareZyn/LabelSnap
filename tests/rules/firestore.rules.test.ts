import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'labelsnap-12765',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

/** The same batch the app commits on first sign-in. */
function bootstrapBatch(db: ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore'] extends () => infer F ? F : never, uid: string, spaceUid = uid, role = 'owner') {
  const sid = `personal_${spaceUid}`;
  const b = writeBatch(db);
  b.set(doc(db, 'spaces', sid), { name: 'Me', type: 'personal', ownerUid: spaceUid, documentCount: 0, createdAt: serverTimestamp() });
  b.set(doc(db, 'spaces', sid, 'members', uid), { uid, role, joinedAt: serverTimestamp() });
  b.set(doc(db, 'users', uid), { uid, defaultSpaceId: sid });
  return b;
}

describe('personal space bootstrap', () => {
  it('lets a user create their own personal space and owner membership', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertSucceeds(bootstrapBatch(db, 'alice').commit());
  });

  it('refuses a personal space for someone else', async () => {
    const db = env.authenticatedContext('mallory').firestore();
    await assertFails(bootstrapBatch(db, 'mallory', 'alice').commit());
  });

  it('refuses unauthenticated writes', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'spaces/personal_x'), { ownerUid: 'x', type: 'personal' }));
  });
});

describe('space membership', () => {
  beforeEach(async () => {
    await bootstrapBatch(env.authenticatedContext('alice').firestore(), 'alice').commit();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'spaces/personal_alice/members/victor'), { uid: 'victor', role: 'viewer' });
      await setDoc(doc(db, 'spaces/personal_alice/documents/d1'), { title: 'Doc', status: 'active' });
      await setDoc(doc(db, 'spaces/personal_alice/documents/d1/entries/e1'), { caption: 'x', order: 1 });
    });
  });

  it('lets the owner read and write documents and entries', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(db, 'spaces/personal_alice/documents/d1')));
    await assertSucceeds(setDoc(doc(db, 'spaces/personal_alice/documents/d2'), { title: 'New' }));
    await assertSucceeds(updateDoc(doc(db, 'spaces/personal_alice/documents/d1/entries/e1'), { caption: 'y' }));
    await assertSucceeds(setDoc(doc(db, 'spaces/personal_alice/documents/d1/entries/e1/ocr/result'), { rawText: 'LOT 1' }));
  });

  it('lets a viewer read but not write', async () => {
    const db = env.authenticatedContext('victor').firestore();
    await assertSucceeds(getDoc(doc(db, 'spaces/personal_alice/documents/d1/entries/e1')));
    await assertFails(updateDoc(doc(db, 'spaces/personal_alice/documents/d1/entries/e1'), { caption: 'y' }));
    await assertFails(setDoc(doc(db, 'spaces/personal_alice/templates/t1'), { name: 'T' }));
  });

  it('keeps non-members out entirely', async () => {
    const db = env.authenticatedContext('mallory').firestore();
    await assertFails(getDoc(doc(db, 'spaces/personal_alice')));
    await assertFails(getDoc(doc(db, 'spaces/personal_alice/documents/d1')));
    await assertFails(setDoc(doc(db, 'spaces/personal_alice/documents/evil'), { title: 'x' }));
  });

  it('does not let a member promote themselves', async () => {
    const db = env.authenticatedContext('victor').firestore();
    await assertFails(updateDoc(doc(db, 'spaces/personal_alice/members/victor'), { role: 'owner' }));
    await assertFails(setDoc(doc(db, 'spaces/personal_alice/members/mallory'), { role: 'owner' }));
  });

  it('only lets editors touch the space counter, not its owner', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'spaces/personal_alice/members/ed'), { uid: 'ed', role: 'editor' });
    });
    const db = env.authenticatedContext('ed').firestore();
    await assertSucceeds(updateDoc(doc(db, 'spaces/personal_alice'), { documentCount: 3 }));
    await assertFails(updateDoc(doc(db, 'spaces/personal_alice'), { ownerUid: 'ed' }));
  });
});

describe('user documents', () => {
  it('are private to their owner', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice/settings/preferences'), { theme: 'light' });
    });
    await assertSucceeds(getDoc(doc(env.authenticatedContext('alice').firestore(), 'users/alice/settings/preferences')));
    await assertFails(getDoc(doc(env.authenticatedContext('bob').firestore(), 'users/alice/settings/preferences')));
    await assertFails(setDoc(doc(env.authenticatedContext('bob').firestore(), 'users/alice'), { lastDocumentId: 'x' }));
  });

  it('built-in templates are read-only', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(db, 'templates/builtin-single')));
    await assertFails(setDoc(doc(db, 'templates/builtin-single'), { name: 'hacked' }));
  });
});
