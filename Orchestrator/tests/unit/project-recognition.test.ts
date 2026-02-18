/**
 * Unit tests for project-recognition fuzzy matching and clustering logic.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeProjectName,
  projectNamesMatch,
  extractItems,
  parseTextTable,
  clusterProjects,
} from '../../src/jobs/project-recognition.js';
import type { DiscoveredMCPProjects } from '../../src/jobs/project-recognition.js';

describe('normalizeProjectName', () => {
  it('should lowercase the name', () => {
    expect(normalizeProjectName('Customer Lens')).toBe('customer lens');
  });

  it('should replace dashes and underscores with spaces', () => {
    expect(normalizeProjectName('customer-lens')).toBe('customer lens');
    expect(normalizeProjectName('customer_lens')).toBe('customer lens');
  });

  it('should strip environment suffixes', () => {
    expect(normalizeProjectName('customer-lens-prod')).toBe('customer lens');
    expect(normalizeProjectName('customer-lens-staging')).toBe('customer lens');
    expect(normalizeProjectName('customer-lens-dev')).toBe('customer lens');
    expect(normalizeProjectName('customer-lens-test')).toBe('customer lens');
    expect(normalizeProjectName('customer-lens-preview')).toBe('customer lens');
    expect(normalizeProjectName('Customer Lens Production')).toBe('customer lens');
    expect(normalizeProjectName('Customer Lens Development')).toBe('customer lens');
  });

  it('should collapse multiple spaces', () => {
    expect(normalizeProjectName('customer   lens')).toBe('customer lens');
  });

  it('should trim whitespace', () => {
    expect(normalizeProjectName('  customer-lens  ')).toBe('customer lens');
  });

  it('should handle already clean names', () => {
    expect(normalizeProjectName('myproject')).toBe('myproject');
  });

  it('should not strip suffixes that are part of the actual name', () => {
    // "dev" in the middle should not be stripped
    expect(normalizeProjectName('devtools')).toBe('devtools');
    expect(normalizeProjectName('pro-device')).toBe('pro device');
  });
});

describe('projectNamesMatch', () => {
  it('should match identical names', () => {
    expect(projectNamesMatch('customer-lens', 'customer-lens')).toBe(true);
  });

  it('should match case-insensitive', () => {
    expect(projectNamesMatch('Customer Lens', 'customer lens')).toBe(true);
  });

  it('should match with dashes vs spaces', () => {
    expect(projectNamesMatch('customer-lens', 'Customer Lens')).toBe(true);
  });

  it('should match with environment suffixes stripped', () => {
    expect(projectNamesMatch('customer-lens-prod', 'Customer Lens')).toBe(true);
    expect(projectNamesMatch('customer-lens', 'customer-lens-staging')).toBe(true);
  });

  it('should match via substring containment', () => {
    expect(projectNamesMatch('customer-lens-app', 'customer lens')).toBe(true);
    expect(projectNamesMatch('customer lens', 'customer-lens-monorepo')).toBe(true);
  });

  it('should not match unrelated names', () => {
    expect(projectNamesMatch('customer-lens', 'billing-api')).toBe(false);
    expect(projectNamesMatch('project-alpha', 'project-beta')).toBe(false);
  });

  it('should not match very short names as substrings', () => {
    // Short names (2 chars or less) should only match exactly
    expect(projectNamesMatch('ab', 'abcdef')).toBe(false);
  });

  it('should handle empty strings', () => {
    expect(projectNamesMatch('', '')).toBe(true);
    expect(projectNamesMatch('', 'something')).toBe(false);
  });

  it('should match cross-provider examples', () => {
    // Typical scenario: same project on Vercel, PostHog, and Neon
    expect(projectNamesMatch('customer-lens', 'Customer Lens')).toBe(true);
    expect(projectNamesMatch('customer-lens', 'customer_lens')).toBe(true);
    expect(projectNamesMatch('customer-lens-prod', 'customer lens')).toBe(true);
  });
});

describe('extractItems', () => {
  it('should extract from a plain array', () => {
    const data = [
      { id: '1', name: 'Project A' },
      { id: '2', name: 'Project B' },
    ];
    const items = extractItems(data, 'id', 'name');
    expect(items).toEqual([
      { id: '1', name: 'Project A' },
      { id: '2', name: 'Project B' },
    ]);
  });

  it('should extract with custom field names', () => {
    const data = [
      { projectId: 'abc', title: 'My App' },
    ];
    const items = extractItems(data, 'projectId', 'title');
    expect(items).toEqual([{ id: 'abc', name: 'My App' }]);
  });

  it('should unwrap StandardResponse { data: ... }', () => {
    const data = {
      success: true,
      data: {
        projects: [
          { id: 1, name: 'Wrapped Project' },
        ],
      },
    };
    const items = extractItems(data, 'id', 'name');
    expect(items).toEqual([{ id: 1, name: 'Wrapped Project' }]);
  });

  it('should extract from nested "projects" field', () => {
    const data = { projects: [{ id: 'p1', name: 'Nested' }] };
    const items = extractItems(data, 'id', 'name');
    expect(items).toEqual([{ id: 'p1', name: 'Nested' }]);
  });

  it('should extract from nested "results" field', () => {
    const data = { results: [{ id: 'r1', name: 'Result Item' }] };
    const items = extractItems(data, 'id', 'name');
    expect(items).toEqual([{ id: 'r1', name: 'Result Item' }]);
  });

  it('should extract from nested "repos" field', () => {
    const data = { repos: [{ id: 'repo1', name: 'My Repo' }] };
    const items = extractItems(data, 'id', 'name');
    expect(items).toEqual([{ id: 'repo1', name: 'My Repo' }]);
  });

  it('should extract from nested "repositories" field', () => {
    const data = { repositories: [{ id: 'repo2', name: 'Another Repo' }] };
    const items = extractItems(data, 'id', 'name');
    expect(items).toEqual([{ id: 'repo2', name: 'Another Repo' }]);
  });

  it('should extract a single item from a flat object', () => {
    const data = { id: 'solo', name: 'Solo Project' };
    const items = extractItems(data, 'id', 'name');
    expect(items).toEqual([{ id: 'solo', name: 'Solo Project' }]);
  });

  it('should return empty for null/undefined', () => {
    expect(extractItems(null, 'id', 'name')).toEqual([]);
    expect(extractItems(undefined, 'id', 'name')).toEqual([]);
  });

  it('should return empty for primitives', () => {
    expect(extractItems('string', 'id', 'name')).toEqual([]);
    expect(extractItems(42, 'id', 'name')).toEqual([]);
  });

  it('should return empty for object without matching fields', () => {
    const data = { foo: 'bar', baz: 123 };
    const items = extractItems(data, 'id', 'name');
    expect(items).toEqual([]);
  });

  it('should skip non-object items in array', () => {
    const data = [
      { id: '1', name: 'Valid' },
      null,
      'string',
      { id: '2', name: 'Also Valid' },
    ];
    const items = extractItems(data, 'id', 'name');
    expect(items).toEqual([
      { id: '1', name: 'Valid' },
      { id: '2', name: 'Also Valid' },
    ]);
  });

  it('should handle deeply nested StandardResponse with array field', () => {
    // StandardResponse wrapping an object that has a "projects" array
    const data = {
      success: true,
      data: [
        { id: 'd1', name: 'Deep Item' },
      ],
    };
    const items = extractItems(data, 'id', 'name');
    expect(items).toEqual([{ id: 'd1', name: 'Deep Item' }]);
  });

  it('should extract from "deployments" field', () => {
    const data = {
      pagination: { count: 2, next: 123, prev: 456 },
      deployments: [
        { name: 'paperwork', projectId: 'prj_abc', state: 'READY' },
        { name: 'customer-lens', projectId: 'prj_def', state: 'READY' },
      ],
    };
    const items = extractItems(data, 'name', 'name');
    expect(items).toEqual([
      { id: 'paperwork', name: 'paperwork' },
      { id: 'customer-lens', name: 'customer-lens' },
    ]);
  });
});

describe('clusterProjects', () => {
  it('should group matching projects from different MCPs into one cluster', () => {
    const discovered: DiscoveredMCPProjects[] = [
      { mcpName: 'vercel', projects: [{ id: 'v1', name: 'customer-lens' }] },
      { mcpName: 'posthog', projects: [{ id: 'p1', name: 'Customer Lens' }] },
      { mcpName: 'neon', projects: [{ id: 'n1', name: 'customer_lens' }] },
    ];
    const clusters = clusterProjects(discovered, []);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].sources).toHaveLength(3);
    expect(clusters[0].sources.map(s => s.mcpName).sort()).toEqual(['neon', 'posthog', 'vercel']);
  });

  it('should create separate clusters for unrelated projects', () => {
    const discovered: DiscoveredMCPProjects[] = [
      { mcpName: 'vercel', projects: [
        { id: 'v1', name: 'customer-lens' },
        { id: 'v2', name: 'billing-api' },
      ] },
      { mcpName: 'posthog', projects: [{ id: 'p1', name: 'Customer Lens' }] },
    ];
    const clusters = clusterProjects(discovered, []);

    expect(clusters).toHaveLength(2);

    const clNames = clusters.map(c => c.normalizedName).sort();
    expect(clNames).toEqual(['billing api', 'customer lens']);
  });

  it('should match cluster against unified projects', () => {
    const discovered: DiscoveredMCPProjects[] = [
      { mcpName: 'vercel', projects: [{ id: 'v1', name: 'customer-lens-prod' }] },
    ];
    const unified = [{ id: 42, name: 'Customer Lens' }];

    const clusters = clusterProjects(discovered, unified);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].unifiedProjectId).toBe(42);
    expect(clusters[0].unifiedProjectName).toBe('Customer Lens');
  });

  it('should leave unifiedProjectId undefined when no match', () => {
    const discovered: DiscoveredMCPProjects[] = [
      { mcpName: 'vercel', projects: [{ id: 'v1', name: 'new-project' }] },
    ];
    const unified = [{ id: 1, name: 'Something Else' }];

    const clusters = clusterProjects(discovered, unified);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].unifiedProjectId).toBeUndefined();
    expect(clusters[0].unifiedProjectName).toBeUndefined();
  });

  it('should handle empty discovered list', () => {
    const clusters = clusterProjects([], [{ id: 1, name: 'Customer Lens' }]);
    expect(clusters).toHaveLength(0);
  });

  it('should handle multiple projects from a single MCP', () => {
    const discovered: DiscoveredMCPProjects[] = [
      { mcpName: 'vercel', projects: [
        { id: 'v1', name: 'project-alpha' },
        { id: 'v2', name: 'project-beta' },
        { id: 'v3', name: 'project-gamma' },
      ] },
    ];
    const clusters = clusterProjects(discovered, []);

    expect(clusters).toHaveLength(3);
  });

  it('should cluster projects with environment suffix variants', () => {
    const discovered: DiscoveredMCPProjects[] = [
      { mcpName: 'vercel', projects: [{ id: 'v1', name: 'myapp-prod' }] },
      { mcpName: 'neon', projects: [{ id: 'n1', name: 'myapp-staging' }] },
    ];
    const clusters = clusterProjects(discovered, []);

    // Both normalize to "myapp", should be in one cluster
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sources).toHaveLength(2);
  });

  it('should include externalId and externalName in sources', () => {
    const discovered: DiscoveredMCPProjects[] = [
      { mcpName: 'vercel', projects: [{ id: 'prj_abc', name: 'customer-lens' }] },
    ];
    const clusters = clusterProjects(discovered, []);

    expect(clusters[0].sources[0]).toEqual({
      mcpName: 'vercel',
      externalId: 'prj_abc',
      externalName: 'customer-lens',
    });
  });
});

describe('parseTextTable', () => {
  it('should parse PostHog-style text table', () => {
    const text = [
      '[3]{id,name,organization,api_token}:',
      '  79461,Customers Lens,My Org,phc_abc123',
      '  272876,Paperwork.vc,My Org,phc_def456',
      '  298248,Customers Academy,My Org,phc_ghi789',
    ].join('\n');

    const items = parseTextTable(text, 'id', 'name');
    expect(items).toEqual([
      { id: '79461', name: 'Customers Lens' },
      { id: '272876', name: 'Paperwork.vc' },
      { id: '298248', name: 'Customers Academy' },
    ]);
  });

  it('should handle single row', () => {
    const text = '[1]{id,name}:\n  42,My Project';
    const items = parseTextTable(text, 'id', 'name');
    expect(items).toEqual([{ id: '42', name: 'My Project' }]);
  });

  it('should return empty for non-table text', () => {
    expect(parseTextTable('just some text', 'id', 'name')).toEqual([]);
    expect(parseTextTable('{"json": true}', 'id', 'name')).toEqual([]);
  });

  it('should return empty when fields not found in header', () => {
    const text = '[1]{foo,bar}:\n  1,test';
    const items = parseTextTable(text, 'id', 'name');
    expect(items).toEqual([]);
  });

  it('should skip empty lines', () => {
    const text = '[2]{id,name}:\n  1,First\n\n  2,Second\n';
    const items = parseTextTable(text, 'id', 'name');
    expect(items).toEqual([
      { id: '1', name: 'First' },
      { id: '2', name: 'Second' },
    ]);
  });

  it('should handle fields in different positions', () => {
    const text = '[1]{organization,id,name,token}:\n  MyOrg,99,Cool Project,tok_abc';
    const items = parseTextTable(text, 'id', 'name');
    expect(items).toEqual([{ id: '99', name: 'Cool Project' }]);
  });

  it('should handle custom field names', () => {
    const text = '[1]{project_id,title,status}:\n  abc,My App,active';
    const items = parseTextTable(text, 'project_id', 'title');
    expect(items).toEqual([{ id: 'abc', name: 'My App' }]);
  });
});
