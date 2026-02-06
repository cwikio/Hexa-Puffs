/**
 * Logger for Gmail MCP
 * Re-exports the shared Logger to avoid duplicating the implementation.
 */

export { Logger } from "@mcp/shared/Utils/logger.js";
export type { LogLevel } from "@mcp/shared/Utils/logger.js";

import { Logger } from "@mcp/shared/Utils/logger.js";

/** Default logger instance */
export const logger = new Logger("gmail");
