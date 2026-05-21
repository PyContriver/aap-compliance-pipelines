/**
 * Backend plugin registration for the compliance plugin.
 *
 * Registers:
 *   - Database migrations (Knex)
 *   - ComplianceService (mock/live toggle)
 *   - REST router at /api/compliance/*
 *
 * Auth model (Option A+C):
 *   - Backstage layer: httpAuth + permissions service gate mutating
 *     endpoints behind catalogEntityCreatePermission (admin tier).
 *     Read-only endpoints are open to all authenticated users.
 *   - AAP layer: per-user AAP OAuth2 tokens are passed through to
 *     Controller API calls via x-aap-token header. AAP RBAC decides
 *     what inventories/JTs/credentials the user can access.
 *   - Development mode: compliance.authMode = 'development' marks all
 *     routes unauthenticated so ./bin/start.sh mock works without auth.
 */
import * as path from 'path';
import * as fs from 'fs';
import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';

import { ComplianceService } from './service/ComplianceService';
import { ComplianceDatabase } from './database/ComplianceDatabase';
import { createRouter } from './router';

export const complianceBackendPlugin = createBackendPlugin({
  pluginId: 'compliance',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        httpRouter: coreServices.httpRouter,
        database: coreServices.database,
        httpAuth: coreServices.httpAuth,
        permissions: coreServices.permissions,
      },
      async init({ logger, config, httpRouter, database, httpAuth, permissions }) {
        logger.info('Initializing compliance backend plugin');

        // ─── Auth mode ──────────────────────────────────────────
        //
        // 'development' (default): all routes unauthenticated — for
        //   standalone dev shell with guest auth (./bin/start.sh mock).
        // 'production': only /health is unauthenticated. All other
        //   routes require Backstage auth. Mutating endpoints are
        //   additionally gated by catalogEntityCreatePermission via
        //   the permissions service in the router.
        const authMode = config.getOptionalString('compliance.authMode') ?? 'development';
        logger.info(`Compliance auth mode: ${authMode}`);

        // ─── Database ───────────────────────────────────────────
        const dbClient = await database.getClient();

        // Run migrations — check package-root migrations/ first (dist-dynamic),
        // then fall back to compiled database/migrations/ (local dev).
        const packageMigrations = path.resolve(__dirname, '..', 'migrations');
        const compiledMigrations = path.resolve(__dirname, 'database', 'migrations');
        const migrationsDir = fs.existsSync(packageMigrations) ? packageMigrations : compiledMigrations;
        await dbClient.migrate.latest({
          directory: migrationsDir,
          tableName: 'compliance_knex_migrations',
        });
        logger.info('Compliance database migrations applied');

        const complianceDb = new ComplianceDatabase(dbClient);

        // ─── Data retention cleanup ────────────────────────────
        const retentionDays = config.getOptionalNumber('compliance.retentionDays') ?? 90;
        try {
          const cleanedUp = await complianceDb.cleanupOldFindings(retentionDays);
          if (cleanedUp > 0) {
            logger.info(
              `Data retention: cleaned up ${cleanedUp} findings older than ${retentionDays} days`,
            );
          }
        } catch (cleanupError) {
          logger.warn(
            `Data retention cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          );
        }

        // ─── Service ────────────────────────────────────────────
        const service = new ComplianceService(config, logger);
        service.setDatabase(complianceDb);
        logger.info(
          `Compliance service ready (dataSource=${service.getDataSource()})`,
        );

        // ─── Router ─────────────────────────────────────────────
        //
        // In production mode, pass httpAuth and permissions to the
        // router so it can enforce catalogEntityCreatePermission on
        // mutating endpoints. In development mode, omit them so that
        // the router skips permission checks entirely.
        const router = await createRouter({
          logger,
          service,
          database: complianceDb,
          configRetentionDays: retentionDays,
          ...(authMode === 'production' ? { httpAuth, permissions } : {}),
        });

        httpRouter.use(router);

        // ─── Auth Policies ───────────────────────────────────────

        if (authMode === 'development') {
          // Development mode: all routes unauthenticated for guest-auth.
          // This is the standalone dev shell path (./bin/start.sh mock).

          // --- Read-only endpoints ---
          httpRouter.addAuthPolicy({ path: '/health', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/profiles', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/scans', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/findings', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/cartridges', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/inventories', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/dashboard', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/posture', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/workflow-templates', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/workflow-status', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/workflow-nodes', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/job-events', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/job-status', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/controller', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/previous-findings', allow: 'unauthenticated' });

          // --- Mutating endpoints ---
          httpRouter.addAuthPolicy({ path: '/scan', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/remediate', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/remediation-profiles', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/remediation-profiles/:id', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/settings', allow: 'unauthenticated' });
          httpRouter.addAuthPolicy({ path: '/cleanup', allow: 'unauthenticated' });
        } else {
          // Production mode: only /health is unauthenticated.
          // All other routes require Backstage auth (JWT validation).
          // Mutating endpoints are additionally gated by
          // catalogEntityCreatePermission in the router.
          httpRouter.addAuthPolicy({ path: '/health', allow: 'unauthenticated' });
        }
      },
    });
  },
});
