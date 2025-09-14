const conversation = require('../src/bot/conversation');
const { STATES } = conversation;

describe('Conversation state machine', () => {
  test('New user gets welcome and moves to PLATFORM_SELECT', async () => {
    const sessionId = 'testuser1';
    const res1 = await conversation.handleIncoming(sessionId, 'hi');
    expect(res1.session.state).toBe(STATES.PLATFORM_SELECT);
    expect(res1.reply).toContain('Welcome to CodeSkytz');

    // choose invalid option
    const res2 = await conversation.handleIncoming(sessionId, '99');
    expect(res2.session.state).toBe(STATES.PLATFORM_SELECT);
    expect(res2.reply).toMatch(/Invalid choice/i);

    // choose valid option
    const res3 = await conversation.handleIncoming(sessionId, '1');
    expect(res3.session.state).toBe(STATES.CATEGORY_SELECT);
    expect(res3.reply).toContain('Instagram');
  });

  test('.help returns help text without changing state', async () => {
    const sessionId = 'testuser2';
    const r = await conversation.handleIncoming(sessionId, '.help');
    expect(r.reply).toContain('Help — Quick Commands');
    expect(r.session.state).toBe(STATES.START);
  });

  test('.status returns not found stub', async () => {
    const sessionId = 'testuser3';
    const r = await conversation.handleIncoming(sessionId, '.status 123');
    expect(r.reply).toContain('not found');
  });
});
