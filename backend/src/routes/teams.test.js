import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerTeamRoutes } from './teams.js';
import { shouldAutoApproveSubmission } from '../services/teams.js';

async function buildApp(deps = {}) {
  const app = Fastify({ logger: false });
  await registerTeamRoutes(app, {
    getTeamSetupState: async () => ({
      team: { id: 'team-1', name: 'Dogfood Team', template: 'high_trust', points_enabled: false, approval_mode: 'auto' },
      openBacklogItems: [],
      submittedApprovalRequests: [],
    }),
    getMyWorkState: async () => ({
      team: { id: 'team-1', name: 'Dogfood Team', template: 'high_trust', points_enabled: false, approval_mode: 'auto' },
      inProgressItems: [],
      openBacklogItems: [],
      approvedItems: [],
    }),
    getTeamReviewState: async () => ({
      ownedTeams: [{ id: 'team-1', name: 'Dogfood Team' }],
      canManage: true,
      activeApprovalRequests: [],
      recentDecisions: [],
    }),
    updateTeamSettings: async (input) => ({ id: 'team-1', name: input.name.trim(), template: input.template }),
    createBacklogItem: async (input) => ({
      id: 'item-1',
      description: input.description.trim(),
      points: input.points,
      status: 'open',
    }),
    updateOpenBacklogItem: async (id, input) => ({
      id,
      description: input.description.trim(),
      points: input.points,
      status: 'open',
    }),
    deleteOwnedTeam: async () => ({ success: true, team: { id: 'team-1', name: 'Dogfood Team' } }),
    deleteOpenBacklogItem: async () => ({ success: true }),
    claimBacklogItem: async (id) => ({ id, description: 'Tidy desk', status: 'claimed' }),
    submitClaimedBacklogItem: async (id, input) => ({
      backlogItem: { id, description: 'Tidy desk', status: 'approved' },
      approvalRequest: { id: 'approval-1', backlog_item_id: id, status: 'approved', evidence_text: input.evidence_text },
    }),
    decideApprovalRequest: async (id, decision) => ({
      id,
      status: decision,
      backlog_item: { id: 'item-1', status: decision },
    }),
    optionalAuth: async () => null,
    requireAuth: async () => ({ email: 'owner@example.com' }),
    createTeamInvite: async (input, context) => ({
      id: 'invite-1',
      email: input.email.trim().toLowerCase(),
      status: 'pending',
      invited_by_email: context.ownerEmail,
      invite_url: `${context.appBaseUrl}/invite?token=token-1`,
    }),
    resendTeamInvite: async (id, context) => ({
      id,
      email: 'worker@example.com',
      status: 'pending',
      invited_by_email: context.ownerEmail,
      invite_url: `${context.appBaseUrl}/invite?token=token-1`,
    }),
    revokeTeamInvite: async (id, context) => ({
      id,
      status: 'revoked',
      invited_by_email: context.ownerEmail,
    }),
    inspectTeamInvite: async (token) => ({
      available: token === 'token-1',
      team: token === 'token-1' ? { name: 'Dogfood Team' } : undefined,
      message: token === 'token-1' ? undefined : 'This invite is no longer available',
    }),
    acceptTeamInvite: async (token) => ({
      destination: 'my-work',
      alreadyAccepted: token === 'accepted-token',
    }),
    ...deps,
  });
  await app.ready();
  return app;
}

describe('Team setup routes', () => {
  test('returns team setup backlog and submitted approval sections', async () => {
    const app = await buildApp({
      getTeamSetupState: async (context) => ({
        team: { id: 'team-1', name: 'Dogfood Team', template: 'high_trust', points_enabled: false, approval_mode: 'auto' },
        inviteAccess: { canCreate: Boolean(context.ownerEmail) },
        pendingTeamInvites: [],
        openBacklogItems: [{ id: 'item-1', description: 'Empty dishwasher', points: 2, status: 'open' }],
        submittedApprovalRequests: [{ id: 'approval-1', backlog_item_id: 'item-2', status: 'submitted' }],
      }),
      optionalAuth: async () => ({ email: 'owner@example.com' }),
    });

    const res = await app.inject({ method: 'GET', url: '/api/teams/setup', headers: { origin: 'https://frontend.example' } });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.team.name, 'Dogfood Team');
    assert.equal(body.inviteAccess.canCreate, true);
    assert.equal(body.openBacklogItems[0].description, 'Empty dishwasher');
    assert.equal(body.submittedApprovalRequests[0].status, 'submitted');
  });

  test('does not expose Team Setup management data to non-owners', async () => {
    const app = await buildApp({
      getTeamSetupState: async () => ({
        team: { id: 'team-1', name: 'Dogfood Team', template: 'high_trust', points_enabled: false },
        canManage: false,
        inviteAccess: { canCreate: false },
        pendingTeamInvites: [],
        openBacklogItems: [],
        submittedApprovalRequests: [],
      }),
      optionalAuth: async () => ({ email: 'worker@example.com' }),
    });

    const res = await app.inject({ method: 'GET', url: '/api/teams/setup' });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.canManage, false);
    assert.equal(body.inviteAccess.canCreate, false);
    assert.deepEqual(body.openBacklogItems, []);
    assert.deepEqual(body.pendingTeamInvites, []);
  });

  test('updates team setup settings', async () => {
    let savedArgs;
    const app = await buildApp({
      updateTeamSettings: async (input, context) => {
        savedArgs = { input, context };
        return { id: 'team-1', name: input.name.trim(), template: input.template, points_enabled: true };
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/teams/setup',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ' Family team ', template: 'family' }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(savedArgs.input.name, ' Family team ');
    assert.deepEqual(savedArgs.context, { ownerEmail: 'owner@example.com', teamId: null });
    assert.equal(JSON.parse(res.body).team.name, 'Family team');
  });

  test('rejects Team Setup settings changes from non-owners', async () => {
    const app = await buildApp({
      updateTeamSettings: async () => {
        const error = new Error('Only the Team Owner can manage Team Setup.');
        error.statusCode = 403;
        throw error;
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/teams/setup',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Worker edit', template: 'high_trust' }),
    });

    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, 'Only the Team Owner can manage Team Setup.');
  });

  test('returns team worker queue sections', async () => {
    let workContext;
    const app = await buildApp({
      optionalAuth: async () => ({ email: 'worker@example.com' }),
      getMyWorkState: async (context) => {
        workContext = context;
        return {
          team: { id: 'team-1', name: 'Dogfood Team', template: 'high_trust', points_enabled: false },
          inProgressItems: [{ id: 'claimed-1', status: 'claimed', description: 'Clean bench', team: { id: 'team-1', name: 'Dogfood Team' } }],
          openBacklogItems: [{ id: 'open-1', status: 'open', description: 'Sweep floor', team: { id: 'team-1', name: 'Dogfood Team' } }],
          approvedItems: [{ id: 'done-1', status: 'approved', description: 'Empty bins', team: { id: 'team-1', name: 'Dogfood Team' } }],
        };
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/my-work' });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.inProgressItems[0].description, 'Clean bench');
    assert.equal(body.inProgressItems[0].team.name, 'Dogfood Team');
    assert.equal(body.openBacklogItems[0].description, 'Sweep floor');
    assert.equal(body.openBacklogItems[0].team.name, 'Dogfood Team');
    assert.equal(body.approvedItems[0].status, 'approved');
    assert.equal(body.approvedItems[0].team.name, 'Dogfood Team');
    assert.deepEqual(workContext, { userEmail: 'worker@example.com' });
  });

  test('keeps the old Team Work route as a compatibility alias', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/teams/work' });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).openBacklogItems, []);
  });

  test('returns Team Review state for the authenticated owner', async () => {
    let reviewContext;
    const app = await buildApp({
      optionalAuth: async () => ({ email: 'owner@example.com' }),
      getTeamReviewState: async (context) => {
        reviewContext = context;
        return {
          ownedTeams: [{ id: 'team-1', name: 'Dogfood Team' }],
          canManage: true,
          activeApprovalRequests: [{ id: 'approval-1', status: 'submitted', team_id: 'team-1' }],
          recentDecisions: [],
        };
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/teams/review' });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(reviewContext, { ownerEmail: 'owner@example.com' });
    assert.equal(JSON.parse(res.body).activeApprovalRequests[0].status, 'submitted');
  });

  test('defaults Team Owner self-review to auto-approved unless required by setting', () => {
    const manualTeam = { approval_mode: 'manual', require_owner_self_review: false };
    const strictTeam = { approval_mode: 'manual', require_owner_self_review: true };

    assert.equal(shouldAutoApproveSubmission(manualTeam, {
      submitterEmail: 'owner@example.com',
      claimedByEmail: 'OWNER@example.com',
      isSubmitterOwner: true,
    }), true);
    assert.equal(shouldAutoApproveSubmission(strictTeam, {
      submitterEmail: 'owner@example.com',
      claimedByEmail: 'owner@example.com',
      isSubmitterOwner: true,
    }), false);
    assert.equal(shouldAutoApproveSubmission(manualTeam, {
      submitterEmail: 'worker@example.com',
      claimedByEmail: 'worker@example.com',
      isSubmitterOwner: false,
    }), false);
  });

  test('creates an open Backlog Item with description and points', async () => {
    let savedInput;
    const app = await buildApp({
      createBacklogItem: async (input, context) => {
        savedInput = input;
        assert.deepEqual(context, { ownerEmail: 'owner@example.com', teamId: null });
        return { id: 'item-1', description: input.description.trim(), points: input.points, status: 'open' };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/teams/backlog-items',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: '  Tidy desk  ', points: 3 }),
    });

    assert.equal(res.statusCode, 201);
    assert.equal(savedInput.description, '  Tidy desk  ');
    const body = JSON.parse(res.body);
    assert.equal(body.backlogItem.description, 'Tidy desk');
    assert.equal(body.backlogItem.points, 3);
    assert.equal(body.backlogItem.status, 'open');
  });

  test('edits an open Backlog Item', async () => {
    let editArgs;
    const app = await buildApp({
      updateOpenBacklogItem: async (id, input) => {
        editArgs = { id, input };
        return { id, description: input.description.trim(), points: input.points, status: 'open' };
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/teams/backlog-items/item-1',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Clean sink', points: 2 }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(editArgs.id, 'item-1');
    assert.equal(JSON.parse(res.body).backlogItem.description, 'Clean sink');
  });

  test('deletes only through the open Backlog Item path', async () => {
    let deletedId;
    const app = await buildApp({
      deleteOpenBacklogItem: async (id) => {
        deletedId = id;
        return { success: true };
      },
    });

    const res = await app.inject({ method: 'DELETE', url: '/api/teams/backlog-items/item-1' });

    assert.equal(res.statusCode, 200);
    assert.equal(deletedId, 'item-1');
    assert.equal(JSON.parse(res.body).success, true);
  });

  test('deletes an owned Team for the authenticated owner', async () => {
    let deleteArgs;
    const app = await buildApp({
      deleteOwnedTeam: async (id, context) => {
        deleteArgs = { id, context };
        return { success: true, team: { id, name: 'Foo' } };
      },
    });

    const res = await app.inject({ method: 'DELETE', url: '/api/teams/team-1' });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(deleteArgs, { id: 'team-1', context: { ownerEmail: 'owner@example.com' } });
    assert.equal(JSON.parse(res.body).success, true);
    assert.equal(JSON.parse(res.body).team.name, 'Foo');
  });

  test('claims an open Backlog Item', async () => {
    let claimedId;
    const app = await buildApp({
      claimBacklogItem: async (id) => {
        claimedId = id;
        return { id, description: 'Clean bench', status: 'claimed' };
      },
    });

    const res = await app.inject({ method: 'POST', url: '/api/teams/backlog-items/item-1/claim' });

    assert.equal(res.statusCode, 200);
    assert.equal(claimedId, 'item-1');
    assert.equal(JSON.parse(res.body).backlogItem.status, 'claimed');
  });

  test('returns friendly message when another user already claimed a Backlog Item', async () => {
    const app = await buildApp({
      claimBacklogItem: async () => {
        const error = new Error('Someone has already picked this item up.');
        error.statusCode = 409;
        throw error;
      },
    });

    const res = await app.inject({ method: 'POST', url: '/api/teams/backlog-items/item-1/claim' });

    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).error, 'Someone has already picked this item up.');
  });

  test('submits evidence for a claimed Backlog Item', async () => {
    let submitArgs;
    const app = await buildApp({
      submitClaimedBacklogItem: async (id, input) => {
        submitArgs = { id, input };
        return {
          backlogItem: { id, description: 'Clean bench', status: 'submitted' },
          approvalRequest: { id: 'approval-1', backlog_item_id: id, status: 'submitted', evidence_text: input.evidence_text },
        };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/teams/backlog-items/item-1/submit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evidence_text: 'Cleaned it after lunch.' }),
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(submitArgs, { id: 'item-1', input: { evidence_text: 'Cleaned it after lunch.' } });
    assert.equal(JSON.parse(res.body).approvalRequest.evidence_text, 'Cleaned it after lunch.');
  });

  test('requires evidence when submitting claimed work', async () => {
    const app = await buildApp({
      submitClaimedBacklogItem: async () => {
        const error = new Error('Evidence is required');
        error.statusCode = 400;
        throw error;
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/teams/backlog-items/item-1/submit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evidence_text: '' }),
    });

    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Evidence is required');
  });

  test('records approval decisions', async () => {
    let decisionArgs;
    const app = await buildApp({
      decideApprovalRequest: async (id, decision) => {
        decisionArgs = { id, decision };
        return { id, status: decision, backlog_item: { id: 'item-1', status: decision } };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/teams/approval-requests/approval-1/decision',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'needs_more_evidence' }),
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(decisionArgs, { id: 'approval-1', decision: 'needs_more_evidence' });
    assert.equal(JSON.parse(res.body).approvalRequest.status, 'needs_more_evidence');
  });

  test('returns validation errors without a 500', async () => {
    const app = await buildApp({
      createBacklogItem: async () => {
        const error = new Error('Points must be an integer from 1 to 10');
        error.statusCode = 400;
        throw error;
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/teams/backlog-items',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Impossible points', points: 99 }),
    });

    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Points must be an integer from 1 to 10');
  });

  test('creates a pending Team Invite for the authenticated owner', async () => {
    let inviteArgs;
    const app = await buildApp({
      createTeamInvite: async (input, context) => {
        inviteArgs = { input, context };
        return {
          id: 'invite-1',
          email: input.email.trim().toLowerCase(),
          status: 'pending',
          invited_by_email: context.ownerEmail,
          invite_url: `${context.appBaseUrl}/invite?token=token-1`,
        };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/teams/invites',
      headers: { 'content-type': 'application/json', origin: 'https://frontend.example' },
      body: JSON.stringify({ email: ' Worker@Example.com ' }),
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(inviteArgs.context.ownerEmail, 'owner@example.com');
    assert.equal(body.invite.email, 'worker@example.com');
    assert.equal(body.invite.invite_url, 'https://frontend.example/invite?token=token-1');
  });

  test('requires login to create a Team Invite', async () => {
    const app = await buildApp({
      requireAuth: async (_request, reply) => {
        reply.status(401).send({ error: 'Authorization required' });
        return null;
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/teams/invites',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'worker@example.com' }),
    });

    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error, 'Authorization required');
  });

  test('returns friendly duplicate Team Invite message', async () => {
    const app = await buildApp({
      createTeamInvite: async () => {
        const error = new Error('You have already done this one. Did you mean to resend it?');
        error.statusCode = 409;
        throw error;
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/teams/invites',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'worker@example.com' }),
    });

    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).error, 'You have already done this one. Did you mean to resend it?');
  });

  test('revokes a pending Team Invite for the authenticated owner', async () => {
    let revokeArgs;
    const app = await buildApp({
      revokeTeamInvite: async (id, context) => {
        revokeArgs = { id, context };
        return { id, status: 'revoked' };
      },
    });

    const res = await app.inject({ method: 'DELETE', url: '/api/teams/invites/invite-1' });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(revokeArgs, { id: 'invite-1', context: { ownerEmail: 'owner@example.com', teamId: null } });
    assert.equal(JSON.parse(res.body).invite.status, 'revoked');
  });

  test('resends a pending Team Invite for the authenticated owner', async () => {
    let resendArgs;
    const app = await buildApp({
      resendTeamInvite: async (id, context) => {
        resendArgs = { id, context };
        return {
          id,
          email: 'worker@example.com',
          status: 'pending',
          invited_by_email: context.ownerEmail,
          invite_url: `${context.appBaseUrl}/invite?token=token-1`,
        };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/teams/invites/invite-1/resend',
      headers: { origin: 'https://frontend.example' },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(resendArgs, {
      id: 'invite-1',
      context: { ownerEmail: 'owner@example.com', teamId: null, appBaseUrl: 'https://frontend.example' },
    });
    assert.equal(JSON.parse(res.body).invite.email, 'worker@example.com');
  });

  test('inspects and accepts Team Invite tokens for the signed-in invited email', async () => {
    let acceptArgs;
    const app = await buildApp({
      requireAuth: async () => ({ email: 'worker@example.com' }),
      acceptTeamInvite: async (token, context) => {
        acceptArgs = { token, context };
        return { destination: 'my-work', alreadyAccepted: token === 'accepted-token' };
      },
    });

    const inspectRes = await app.inject({ method: 'GET', url: '/api/teams/invites/token-1' });
    assert.equal(inspectRes.statusCode, 200);
    assert.equal(JSON.parse(inspectRes.body).available, true);

    const acceptRes = await app.inject({ method: 'POST', url: '/api/teams/invites/accepted-token/accept' });
    assert.equal(acceptRes.statusCode, 200);
    assert.deepEqual(acceptArgs, { token: 'accepted-token', context: { userEmail: 'worker@example.com' } });
    assert.equal(JSON.parse(acceptRes.body).destination, 'my-work');
    assert.equal(JSON.parse(acceptRes.body).alreadyAccepted, true);
  });

  test('requires login before accepting a Team Invite token', async () => {
    const app = await buildApp({
      requireAuth: async (_request, reply) => {
        reply.status(401).send({ error: 'Authorization required' });
        return null;
      },
    });

    const res = await app.inject({ method: 'POST', url: '/api/teams/invites/token-1/accept' });

    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error, 'Authorization required');
  });
});
