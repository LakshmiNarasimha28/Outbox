import { checkDatabaseConnection, DatabaseHealthStatus } from '../database/mysql';
import { checkRedisConnection, RedisHealthStatus } from '../queue/redis';
import { ElasticsearchService, ElasticsearchHealthStatus } from './elasticsearchService';
import { AuthService } from './authService';
import { env } from '../config/env';

export interface HealthReport {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  version: string;
  services: {
    server: {
      status: 'healthy';
      port: number;
      nodeVersion: string;
    };
    database: DatabaseHealthStatus;
    redis: RedisHealthStatus;
    elasticsearch: ElasticsearchHealthStatus;
    googleAuth: {
      configured: boolean;
      callbackUrl: string;
    };
    slack: {
      configured: boolean;
      callbackUrl: string;
      cooldownSeconds: number;
    };
  };
}

export class HealthService {
  public static async getHealthReport(): Promise<HealthReport> {
    const [dbStatus, redisStatus, esStatus] = await Promise.all([
      checkDatabaseConnection(),
      checkRedisConnection(),
      ElasticsearchService.checkHealth(),
    ]);

    // Core execution requires MySQL and Redis
    const isHealthy = dbStatus.connected && redisStatus.connected;

    return {
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: env.NODE_ENV,
      version: '1.0.0',
      services: {
        server: {
          status: 'healthy',
          port: env.PORT,
          nodeVersion: process.version,
        },
        database: dbStatus,
        redis: redisStatus,
        elasticsearch: esStatus,
        googleAuth: {
          configured: AuthService.isConfigured(),
          callbackUrl: env.GOOGLE_CALLBACK_URL,
        },
        slack: {
          configured: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET),
          callbackUrl: env.SLACK_CALLBACK_URL,
          cooldownSeconds: env.SLACK_NOTIFICATION_COOLDOWN_SECONDS,
        },
      },
    };
  }

  public static getLiveness() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
