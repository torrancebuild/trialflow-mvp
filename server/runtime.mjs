import { createOutboxWorker } from './outbox.mjs'

export function createRuntime({ workflowOutbox, outboundOutbox, processor, whatsappClient, clock } = {}) {
  if (!workflowOutbox || !processor?.process) throw new Error('Workflow outbox and processor are required.')
  const workflowWorker = createOutboxWorker({
    repository: workflowOutbox,
    clock,
    handlers: {
      'process.inbound_message': (payload, { job }) => processor.process({ workspaceId: job.workspaceId ?? job.workspace_id, event: payload.event, eventId: payload.eventId }),
    },
  })
  const outboundWorker = outboundOutbox && whatsappClient
    ? createOutboxWorker({
      repository: outboundOutbox,
      clock,
      beforeSend: async ({ job }) => job.provider === 'simulator' ? { skip: true, result: { provider: 'simulator', simulated: true } } : undefined,
      handlers: {
        default: (_, { job }) => whatsappClient.sendText(job.recipient, job.body, { idempotencyKey: job.idempotency_key ?? job.idempotencyKey }),
      },
    })
    : null
  return Object.freeze({
    workflowWorker,
    outboundWorker,
    async runOnce({ workspaceId, ...options } = {}) {
      const workflow = await workflowWorker.runOnce({ workspaceId, ...options })
      const outbound = outboundWorker ? await outboundWorker.runOnce({ workspaceId, ...options }) : []
      return { workflow, outbound }
    },
  })
}
