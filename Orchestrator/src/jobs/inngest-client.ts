import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'annabelle-orchestrator',
  name: 'Annabelle Orchestrator',
  eventKey: process.env.INNGEST_EVENT_KEY || 'local',
});
