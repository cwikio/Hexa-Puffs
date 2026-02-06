import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'hexa-puffs-orchestrator',
  name: 'Hexa Puffs Orchestrator',
  eventKey: process.env.INNGEST_EVENT_KEY || 'local',
});
