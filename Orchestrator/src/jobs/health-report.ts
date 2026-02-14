import { inngest } from './inngest-client.js';
import { notifyTelegram } from './helpers.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getHaltManager } from '../core/halt-manager.js';

// Proactive Health Report — runs diagnostic checks every 6 hours,
// updates error baseline, and sends Telegram alert if anything degraded.
export const healthReportFunction = inngest.createFunction(
  {
    id: 'proactive-health-report',
    name: 'Proactive Health Report',
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: '0 */6 * * *' }, // Every 6 hours
  async ({ step }) => {
    if (getHaltManager().isTargetHalted('inngest')) {
      return { success: false, halted: true };
    }

    // 1. Run diagnostic checks
    const findings = await step.run('run-diagnostics', async () => {
      const { getOrchestrator } = await import('../core/orchestrator.js');
      const orchestrator = await getOrchestrator();
      const { runDiagnosticChecks } = await import('../commands/diagnostic-checks.js');

      const status = orchestrator.getStatus();
      const ctx = {
        orchestrator,
        toolRouter: orchestrator.getToolRouter(),
        status,
      };

      const result = await runDiagnosticChecks(ctx);
      return result.findings.map((f) => ({
        id: f.id,
        severity: f.severity,
        category: f.category,
        summary: f.summary,
        recommendation: f.recommendation,
      }));
    });

    // 2. Update error baseline
    await step.run('update-baseline', async () => {
      const { updateBaseline } = await import('../commands/error-baseline.js');
      await updateBaseline();
    });

    // 3. Load previous report and compare
    const comparison = await step.run('compare-reports', async () => {
      const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');

      const reportPath = join(homedir(), '.annabelle', 'data', 'last-health-report.json');

      interface HealthReportFinding {
        id: string;
        severity: string;
        category: string;
        summary: string;
        recommendation: string;
      }

      interface PreviousReport {
        timestamp: string;
        findings: HealthReportFinding[];
      }

      let previous: PreviousReport | null = null;
      if (existsSync(reportPath)) {
        try {
          previous = JSON.parse(readFileSync(reportPath, 'utf-8')) as PreviousReport;
        } catch {
          previous = null;
        }
      }

      // Compute diff
      const previousIds = new Set(previous?.findings.map((f) => f.id) ?? []);
      const currentIds = new Set(findings.map((f) => f.id));

      const newIssues = findings.filter((f) => !previousIds.has(f.id));
      const resolved = (previous?.findings ?? []).filter((f) => !currentIds.has(f.id));

      // Save current report
      const report: PreviousReport = {
        timestamp: new Date().toISOString(),
        findings,
      };

      const dir = join(homedir(), '.annabelle', 'data');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

      return {
        newIssues: newIssues.map((f) => ({ id: f.id, severity: f.severity, category: f.category, summary: f.summary })),
        resolved: resolved.map((f) => ({ id: f.id, category: f.category, summary: f.summary })),
        totalFindings: findings.length,
      };
    });

    // 4. Send Telegram alert if anything changed
    if (comparison.newIssues.length > 0 || comparison.resolved.length > 0) {
      await step.run('notify-changes', async () => {
        try {
          const lines: string[] = ['Health Report (6h check)'];

          if (comparison.newIssues.length > 0) {
            lines.push('');
            lines.push('New issues:');
            for (const issue of comparison.newIssues) {
              const icon = issue.severity === 'critical' ? '[!!]' : '[!]';
              lines.push(`${icon} ${issue.category}: ${issue.summary}`);
            }
          }

          if (comparison.resolved.length > 0) {
            lines.push('');
            lines.push('Resolved:');
            for (const resolved of comparison.resolved) {
              lines.push(`[ok] ${resolved.category}: ${resolved.summary}`);
            }
          }

          lines.push('');
          lines.push(
            `${comparison.newIssues.length} new issue${comparison.newIssues.length !== 1 ? 's' : ''}, ` +
            `${comparison.resolved.length} resolved. Run /diagnose for details.`,
          );

          await notifyTelegram(lines.join('\n'));
        } catch (error) {
          logger.error('Failed to send health report notification', { error });
        }
      });
    }

    return {
      success: true,
      findings: comparison.totalFindings,
      newIssues: comparison.newIssues.length,
      resolved: comparison.resolved.length,
    };
  },
);
