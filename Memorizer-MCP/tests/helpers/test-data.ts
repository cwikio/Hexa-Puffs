/**
 * Test Fixtures and Data for Memorizer MCP Tests
 */

// Fact categories
export const CATEGORIES = ['preference', 'background', 'pattern', 'project', 'contact', 'decision'] as const;
export type Category = (typeof CATEGORIES)[number];

// Sample facts by category
export const SAMPLE_FACTS: Record<Category, string[]> = {
  preference: [
    'User prefers dark mode in all applications',
    'User likes TypeScript over JavaScript',
    'User prefers VS Code as their primary editor',
  ],
  background: [
    'User is a senior software engineer',
    'User has 10 years of experience in web development',
    'User works at a startup focused on AI tools',
  ],
  pattern: [
    'User typically works late nights',
    'User prefers to review PRs in the morning',
    'User takes breaks every 2 hours',
  ],
  project: [
    'User is currently working on an MCP server project',
    'User has a side project building a CLI tool',
    'User is learning Rust in their spare time',
  ],
  contact: [
    'User frequently collaborates with Alice on backend tasks',
    'User reports to Bob who is the team lead',
    'User mentors Charlie who joined last month',
  ],
  decision: [
    'User decided to use SQLite for the database',
    'User chose to implement the feature using async/await',
    'User opted for Vitest over Jest for testing',
  ],
};

// Sensitive data patterns that should be blocked
export const SENSITIVE_PATTERNS = {
  openaiKey: 'My OpenAI API key is sk-abc123def456ghi789',
  groqKey: 'The Groq key is gsk_abc123def456',
  anthropicKey: 'Anthropic key: sk-ant-api03-abc123',
  password: 'The database password=SuperSecret123!',
  creditCard: 'Card number: 4111 1111 1111 1111',
  ssn: 'SSN: 123-45-6789',
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQ...',
  awsKey: 'AWS access key: AKIAIOSFODNN7EXAMPLE',
  dbConnection: 'postgresql://admin:password123@localhost:5432/db',
};

// Clean data that should pass sanitizer
export const CLEAN_FACTS = [
  'User prefers to use dark mode',
  'User works with TypeScript daily',
  'User enjoys learning new programming languages',
  'User typically starts work at 9 AM',
  'User is working on a memory management system',
];

// Sample conversations
export const SAMPLE_CONVERSATIONS = [
  {
    userMessage: 'I really love using VS Code for Python development. The extensions are great!',
    agentResponse:
      'VS Code is indeed excellent for Python development. Would you like me to recommend some extensions?',
    tags: ['tools', 'python'],
  },
  {
    userMessage: 'Can you help me debug this TypeScript error?',
    agentResponse: 'Of course! Please share the error message and the relevant code.',
    tags: ['debugging', 'typescript'],
  },
  {
    userMessage: 'I decided to use Prisma for the database ORM.',
    agentResponse: 'Prisma is a solid choice. It provides type-safe database access and great developer experience.',
    tags: ['database', 'decision'],
  },
];

// Short conversations that should skip extraction
export const SHORT_CONVERSATIONS = [
  { userMessage: 'ok', agentResponse: 'got it' },
  { userMessage: 'hi', agentResponse: 'hello' },
  { userMessage: 'thanks', agentResponse: 'you are welcome' },
];

// Profile test data
export const DEFAULT_PROFILE_STRUCTURE = {
  user_info: {},
  preferences: {},
  current_projects: [],
  learned_patterns: [],
};

export const SAMPLE_PROFILE_UPDATES = [
  { path: 'user_info.name', value: 'Alice' },
  { path: 'user_info.role', value: 'Senior Engineer' },
  { path: 'preferences.theme', value: 'dark' },
  { path: 'preferences.language', value: 'en' },
  { path: 'current_projects[0].name', value: 'MCP Server' },
  { path: 'current_projects[0].status', value: 'active' },
];

// Generate unique agent IDs for test isolation
export function generateTestAgentId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Generate unique session IDs
export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Date helpers for search tests
export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

export function getYesterdayString(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

export function getTomorrowString(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}
