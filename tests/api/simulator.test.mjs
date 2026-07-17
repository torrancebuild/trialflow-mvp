import assert from 'node:assert/strict'
import test from 'node:test'
import { createInboundProcessor } from '../../server/processor.mjs'
import { createCustomerSimulator, SIMULATOR_STATUS, buildCustomerPrompt } from '../../server/simulator.mjs'
import { createApiService } from '../../server/service.mjs'

test('customer simulator generates a bounded inbound turn and persists state', async () => {
  const simulation = { id: 'sim-1', conversation_id: 'conv-1', status: 'running', turn_count: 0, max_turns: 2, customer: { name: 'Aisha', phone: '+6590000000' }, goal: 'Change delivery time' }
  const updates = []
  const ingested = []
  const simulator = createCustomerSimulator({
    llm: { complete: async ({ input }) => ({ status: 'ok', output: { text: 'Can you do 6pm?', shouldStop: false }, metadata: { input } }) },
    persistence: {
      getSimulation: async () => simulation,
      getConversationMessages: async () => [{ direction: 'outbound', body: 'How can we help?' }],
      updateSimulation: async ({ patch }) => { Object.assign(simulation, patch); updates.push(patch); return simulation },
    },
    ingestMessage: async (event) => { ingested.push(event); return { accepted: true, eventId: 'e1' } },
  })
  const result = await simulator.next({ workspaceId: 'ws-1', simulationId: 'sim-1', lastOpsReply: 'What time works?' })
  assert.equal(result.status, SIMULATOR_STATUS.RUNNING)
  assert.equal(result.turn, 1)
  assert.equal(ingested[0].text, 'Can you do 6pm?')
  assert.equal(updates[0].turn_count, 1)
  assert.match(buildCustomerPrompt({ scenario: simulation }), /Change delivery time/)
})

test('customer prompt keeps the model anchored to the original request', () => {
  const prompt = buildCustomerPrompt({
    scenario: {
      customer: { background: 'The customer previously wrote: "My child is 6 and Saturday near Orchard works."' },
      goal: 'Continue and resolve the customer’s existing trial booking request.',
      maxTurns: 6,
    },
  })
  assert.match(prompt, /never introduce an unrelated intent or topic/)
  assert.match(prompt, /preserve the important facts from the original request/)
  assert.match(prompt, /trial booking request/)
})

test('simulator stops before calling the model beyond max turns', async () => {
  const simulation = { id: 'sim-1', status: 'running', turn_count: 2, max_turns: 2 }
  let calls = 0
  const simulator = createCustomerSimulator({
    llm: { complete: async () => { calls += 1; return { status: 'ok', output: { text: 'No', shouldStop: false } } } },
    persistence: { getSimulation: async () => simulation, updateSimulation: async () => undefined },
    ingestMessage: async () => undefined,
  })
  const result = await simulator.next({ workspaceId: 'ws-1', simulationId: 'sim-1' })
  assert.equal(result.reason, 'max_turns')
  assert.equal(calls, 0)
})

test('simulator serializes concurrent next-turn requests per simulation', async () => {
  const simulation = { id: 'sim-1', conversation_id: 'conv-1', status: 'running', turn_count: 0, max_turns: 2, customer: {} }
  let active = 0
  let peak = 0
  const simulator = createCustomerSimulator({
    llm: { complete: async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { status: 'ok', output: { text: 'Next', shouldStop: false } }
    } },
    persistence: {
      getSimulation: async () => simulation,
      getConversationMessages: async () => [],
      updateSimulation: async ({ patch }) => { Object.assign(simulation, patch); return simulation },
    },
    ingestMessage: async () => ({ accepted: true }),
  })
  await Promise.all([
    simulator.next({ workspaceId: 'ws-1', simulationId: 'sim-1' }),
    simulator.next({ workspaceId: 'ws-1', simulationId: 'sim-1' }),
  ])
  assert.equal(peak, 1)
  assert.equal(simulation.turn_count, 2)
})

test('simulator pauses safely when the customer provider is unavailable', async () => {
  const simulation = { id: 'sim-1', status: 'running', turn_count: 0, max_turns: 2 }
  const updates = []
  const simulator = createCustomerSimulator({
    llm: { complete: async () => ({ status: 'needs_human', reason: 'llm_unavailable' }) },
    persistence: {
      getSimulation: async () => simulation,
      getConversationMessages: async () => [],
      updateSimulation: async ({ patch }) => { updates.push(patch); Object.assign(simulation, patch); return simulation },
    },
    ingestMessage: async () => { throw new Error('must not inject a message after provider failure') },
  })
  const result = await simulator.next({ workspaceId: 'ws-1', simulationId: 'sim-1' })
  assert.equal(result.status, SIMULATOR_STATUS.PAUSED)
  assert.equal(result.reason, 'llm_unavailable')
  assert.equal(updates[0].last_error, 'llm_unavailable')
  assert.equal(simulation.turn_count, 0)
})

test('simulator inbound turns reprocess an existing task', async () => {
  const calls = []
  const processor = createInboundProcessor({
    persistence: {
      ensureConversation: async () => ({ id: 'conv-1' }),
      createTask: async () => undefined,
      getTaskForConversation: async () => ({ id: 'task-1', draft_reply: 'old' }),
      getConversationMessages: async () => [{ direction: 'inbound', body: 'Hello' }, { direction: 'inbound', body: 'Around 6pm' }],
      updateTask: async (input) => { calls.push(input); return { id: 'task-1', ...input.patch } },
      appendTaskEvent: async () => undefined,
    },
    llm: { complete: async () => ({ status: 'ok', output: { childAge: 6, location: 'Bedok', preferredTime: '6pm', draftReply: 'That works.' }, metadata: {} }) },
    availability: async () => [{ id: 'slot-1' }],
  })
  const result = await processor.process({ workspaceId: 'ws-1', event: { id: 'sim:event:1', provider: 'simulator', externalConversationId: '+6590000000', text: 'Around 6pm' } })
  assert.equal(result.simulated, true)
  assert.equal(calls[0].patch.state, 'ready_to_offer')
  assert.equal(calls[0].patch.draft_reply, 'That works.')
})

test('simulator send is tagged and continues through the simulator only', async () => {
  const queued = []
  const persistence = {
    recordInboundEvent: async () => undefined,
    getTask: async () => ({ id: 'task-1', version: 1, draft_status: 'approved', draft_reply: 'Thanks!', conversation_id: 'conv-1' }),
    getConversation: async () => ({ id: 'conv-1', channel: 'simulator', customer_phone: '+6590000000' }),
    getSimulationForConversation: async () => ({ id: 'sim-1' }),
  }
  const service = createApiService({
    authProvider: { verifyAccessToken: async () => ({ id: 'user-1' }) },
    membershipStore: { getMembership: async () => ({ role: 'operator' }) },
    persistence,
    outbox: { enqueue: async () => undefined, outbound: { enqueue: async (input) => { queued.push(input); return { id: 'out-1' } } } },
    processor: { process: async () => undefined },
    simulator: { next: async () => ({ status: 'running', turn: 2 }) },
  })
  const result = await service.executeTaskAction({ request: { headers: { authorization: 'Bearer token' } }, workspaceId: 'ws-1', taskId: 'task-1', action: 'send', payload: { expectedVersion: 1 } })
  assert.equal(queued[0].provider, 'simulator')
  assert.equal(result.customerTurn.turn, 2)
})

test('simulation lifecycle is workspace-authorized and persists the selected scenario', async () => {
  const calls = []
  const persistence = {
    recordInboundEvent: async () => undefined,
    ensureConversation: async (input) => { calls.push(['conversation', input]); return { id: 'conv-1' } },
    createSimulation: async (input) => { calls.push(['simulation', input]); return { id: 'sim-1', ...input.simulation } },
  }
  const service = createApiService({
    authProvider: { verifyAccessToken: async () => ({ id: 'user-1' }) },
    membershipStore: { getMembership: async () => ({ role: 'operator' }) },
    persistence,
    outbox: { enqueue: async () => undefined },
    processor: { process: async () => undefined },
    simulator: { next: async (input) => ({ status: 'running', ...input }) },
  })
  const request = { headers: { authorization: 'Bearer token' } }
  const started = await service.startSimulation({ request, workspaceId: 'ws-1', scenario: { id: 'delivery', customer: { name: 'Aisha', phone: '+6590000000' }, goal: 'Change delivery time' } })
  assert.equal(started.simulation.id, 'sim-1')
  assert.equal(calls[0][1].provider, 'simulator')
  assert.equal(calls[1][1].simulation.scenario_id, 'delivery')
  const next = await service.nextSimulation({ request, workspaceId: 'ws-1', simulationId: 'sim-1', lastOpsReply: 'What time works?' })
  assert.equal(next.lastOpsReply, 'What time works?')
})
