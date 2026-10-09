import test from 'node:test';
import assert from 'node:assert/strict';

import {
  registerUser,
  loginUser,
  createDirectConversation,
  addMessage,
  getConversationMessages,
} from '../src/lib.js';

test('registerUser creates a valid account', async () => {
  const email = `alice-${Date.now()}@example.com`;
  const user = await registerUser({
    email,
    password: 'StrongPass1!',
    displayName: 'Alice',
  });

  assert.ok(user.id);
  assert.equal(user.email, email);
});

test('loginUser rejects invalid credentials', async () => {
  const email = `login-${Date.now()}@example.com`;
  await registerUser({
    email,
    password: 'StrongPass1!',
    displayName: 'Login User',
  });

  await assert.rejects(async () => {
    await loginUser({ email, password: 'wrong' });
  });
});

test('conversation membership is enforced', async () => {
  const alice = await registerUser({
    email: `charlie-${Date.now()}@example.com`,
    password: 'StrongPass1!',
    displayName: 'Charlie',
  });

  const bob = await registerUser({
    email: `dana-${Date.now()}@example.com`,
    password: 'StrongPass1!',
    displayName: 'Dana',
  });

  const conversation = createDirectConversation({
    userId: alice.id,
    otherUserId: bob.id,
  });

  const messages = getConversationMessages(conversation.id, alice.id);
  assert.ok(Array.isArray(messages));

  await assert.rejects(async () => {
    await addMessage({
      conversationId: conversation.id,
      senderId: 'fake-user-id',
      text: 'Should not work',
    });
  });
});
