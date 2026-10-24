import { ElasticsearchService } from '../services/elasticsearchService';
import { EmailJobRepository } from '../database/repositories/emailJobRepository';
import { closeDatabasePool } from '../database/mysql';
import { env } from '../config/env';

/**
 * Reconciliation script to scan MySQL email jobs and bulk index them into Elasticsearch.
 * Run via: npm run es:sync
 */
async function main() {
  console.log('====================================================');
  console.log('Outbox Labs — Elasticsearch Full Index Reconciliation');
  console.log('====================================================');

  if (!ElasticsearchService.isConfigured()) {
    console.error('❌ Elasticsearch is not configured.');
    console.error('Please define ELASTICSEARCH_NODE in backend/.env before running reconciliation.');
    process.exit(1);
  }

  console.log(`Connecting to Elasticsearch endpoint: ${ElasticsearchService.getMaskedEndpoint()}`);
  const health = await ElasticsearchService.checkHealth();
  if (!health.connected) {
    console.error(`❌ Cannot connect to Elasticsearch: ${health.error}`);
    process.exit(1);
  }
  console.log(`Connected! Cluster: ${health.clusterName || 'default'} (Latency: ${health.latencyMs}ms)`);

  console.log(`Target Index: ${env.ELASTICSEARCH_INDEX}`);
  const initialized = await ElasticsearchService.initIndex();
  if (!initialized) {
    console.error('❌ Failed to initialize index mapping.');
    process.exit(1);
  }

  console.log('\nScanning MySQL email_jobs table for reconciliation...');
  const batchSize = 100;
  let offset = 0;
  let totalIndexed = 0;
  let totalFailed = 0;

  try {
    while (true) {
      const { total, emails } = await EmailJobRepository.findMany({
        limit: batchSize,
        offset,
      });

      if (emails.length === 0) {
        break;
      }

      console.log(`Syncing batch of ${emails.length} records (offset ${offset} of ${total} total)...`);
      const result = await ElasticsearchService.bulkIndex(emails);
      totalIndexed += result.indexed;
      totalFailed += result.failed;

      offset += emails.length;
      if (offset >= total) {
        break;
      }
    }

    console.log('\n====================================================');
    console.log(`✓ Reconciliation complete!`);
    console.log(`  Indexed: ${totalIndexed}`);
    console.log(`  Failed:  ${totalFailed}`);
    console.log('====================================================');
  } catch (err) {
    console.error('Error during reconciliation:', err);
    process.exit(1);
  } finally {
    await ElasticsearchService.close();
    await closeDatabasePool();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
