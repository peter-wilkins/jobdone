import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamInviteEmailData } from './teams.js';

test('builds custom Supabase template data for Team invite emails', () => {
  const data = teamInviteEmailData({
    inviteUrl: 'https://frontend.example/invite?token=abc',
    teamName: 'Dog Food Team',
    inviterEmail: 'owner@example.com',
  });

  assert.deepEqual(data, {
    email_kind: 'team_invite',
    app_name: 'JobDone',
    team_name: 'Dog Food Team',
    inviter_email: 'owner@example.com',
    invite_url: 'https://frontend.example/invite?token=abc',
    action_text: 'Join Team',
    headline: 'Join Dog Food Team on JobDone',
    message: 'You have been invited to a Team on JobDone. Tap the link to sign in and see your Backlog.',
  });
});

