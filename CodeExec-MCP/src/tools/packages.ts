/**
 * Package management tool schema and handler.
 *
 * install_package — pip/npm install into a session or globally.
 */

import { z } from 'zod';
import type { SessionManager } from '../sessions/manager.js';

export const installPackageSchema = z.object({
  language: z
    .enum(['python', 'node'])
    .describe('Package manager: python (pip) or node (npm)'),
  package: z
    .string()
    .min(1)
    .describe('Package name to install (e.g., "pandas", "lodash")'),
  session_id: z
    .string()
    .nullish()
    .describe('Install into a specific session. If omitted, installs globally.'),
});

export type InstallPackageInput = z.infer<typeof installPackageSchema>;

export function handleInstallPackage(manager: SessionManager) {
  return async (input: InstallPackageInput) => {
    return manager.installPackage({
      language: input.language,
      packageName: input.package,
      sessionId: input.session_id ?? undefined,
    });
  };
}
