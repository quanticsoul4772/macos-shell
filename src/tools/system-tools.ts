// System Tools Module
// System health and monitoring tools

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionManager } from '../session-manager.js';

export function registerSystemTools(server: McpServer, sessionManager: SessionManager) {
  // get_system_health tool
  server.tool(
    "get_system_health",
    {},
    async () => {
      const memoryUsage = process.memoryUsage();
      const health = {
        memoryUsage: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024)
        },
        activeProcesses: sessionManager.listBackgroundProcesses().length,
        sessionCount: sessionManager.listSessions().length,
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid
      };
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(health, null, 2)
          }
        ]
      };
    }
  );
}
