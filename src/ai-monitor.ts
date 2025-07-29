/**
 * AI Performance Monitor
 * Track optimization effectiveness
 */

import { aiCache } from './ai-cache.js';
import { aiDedup } from './ai-dedup.js';
import { aiErrorHandler } from './ai-error-handler.js';
import { getLogger } from './utils/logger.js';

const logger = getLogger('AIMonitor');

export function startMonitoring(): void {
  // Log startup
  logger.info('Starting performance monitoring...');
  
  setInterval(() => {
    const cacheStats = aiCache.getStats();
    const dedupStats = aiDedup.getStats();
    const errorStats = aiErrorHandler.getStats();
    
    const stats = {
      cacheHitRate: `${(cacheStats.hitRate || 0).toFixed(1)}%`,
      cacheSize: cacheStats.cacheSize,
      commandsDedupedRate: `${(dedupStats.dedupRate || 0).toFixed(1)}%`,
      errorsRecoveredRate: `${(errorStats.recoveryRate || 0).toFixed(1)}%`,
      topPatterns: cacheStats.topPatterns?.slice(0, 3).map((p: any) => p[0]) || []
    };
    
    logger.info('AI Optimization Stats', undefined, stats);
  }, 60000); // Every minute
}
