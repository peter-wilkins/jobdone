import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerTeamRoutes } from './teams.js';

async function buildApp(deps = {}) {
  const app = Fastify({ logger: false });
  await registerTeamRoutes(app, {
    getTeamSetupState: async () => ({
      team: { id: 'team-1', name: 'Dogfood Team', template: 'high_trust', points_enabled: false, approval_mode: 'auto' },
      openBacklogItems: [],
      submittedApprovalRequests: [],
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
    deleteOpenBacklogItem: async () => ({ success: true }),
    decideApprovalRequest: async (id, decision) => ({
      id,
      status: decision,
      backlog_item: { id: 'item-1', status: decision },
    }),
    ...deps,
  });
  await app.ready();
  return app;
}

describe('Team setup routes', () => {
  test('returns team setup backlog and submitted approval sections', async () => {
    const app = await buildApp({
      getTeamSetupState: async () => ({
        team: { id: 'team-1', name: 'Dogfood Team', template: 'high_trust', points_enabled: false, approval_mode: 'auto' },
        openBacklogItems: [{ id: 'item-1', description: 'Empty dishwasher', points: 2, status: 'open' }],
        submittedApprovalRequests: [{ id: 'approval-1', backlog_item_id: 'item-2', status: 'submitted' }],
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/api/teams/setup' });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.team.name, 'Dogfood Team');
    assert.equal(body.openBacklogItems[0].description, 'Empty dishwasher');
    assert.equal(body.submittedApprovalRequests[0].status, 'submitted');
  });

  test('updates team setup settings', async () => {
    let savedInput;
    const app = await buildApp({
      updateTeamSettings: async (input) => {
        savedInput = input;
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
    assert.equal(savedInput.name, ' Family team ');
    assert.equal(JSON.parse(res.body).team.name, 'Family team');
  });

  test('creates an open Backlog Item with description and points', async () => {
    let savedInput;
    const app = await buildApp({
      createBacklogItem: async (input) => {
        savedInput = input;
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
});
