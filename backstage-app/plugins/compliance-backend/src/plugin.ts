/**
 * Backend plugin registration for the compliance plugin.
 *
 * Registers:
 *   - Database migrations (Knex)
 *   - ComplianceService (mock/live toggle)
 *   - REST router at /api/compliance/*
 */
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
      },
      async init({ logger, config, httpRouter, database }) {
        logger.info('Initializing compliance backend plugin');

        // ─── Database ───────────────────────────────────────────
        const dbClient = await database.getClient();

        // Run migrations
        const migrationsDir = require('path').resolve(
          __dirname,
          'database',
          'migrations',
        );
        await dbClient.migrate.latest({
          directory: migrationsDir,
          tableName: 'compliance_knex_migrations',
        });
        logger.info('Compliance database migrations applied');

        const complianceDb = new ComplianceDatabase(dbClient);

        // ─── Service ────────────────────────────────────────────
        const service = new ComplianceService(config, logger);
        service.setDatabase(complianceDb);
        logger.info(
          `Compliance service ready (dataSource=${service.getDataSource()})`,
        );

        // ─── Router ─────────────────────────────────────────────
        const router = await createRouter({
          logger,
          service,
          database: complianceDb,
        });

        httpRouter.use(router);

        // ─── Auth Policies ───────────────────────────────────────
        //
        // PROTOTYPE PHASE: All routes are marked unauthenticated so that
        // Backstage guest-auth works out of the box. Each route is listed
        // explicitly so the production upgrade path is clear.
        //
        // PRODUCTION UPGRADE (TODO):
        //   1. Install auth-backend-module-rhaap-provider for AAP Gateway OAuth2.
        //   2. Remove every addAuthPolicy call below — the Backstage httpRouter
        //      will enforce JWT validation automatically.
        //   3. Add 'compliance' to permission.rbac.pluginsWithPermission in
        //      app-config so that @backstage-community/plugin-rbac-backend
        //      gates access.
        //   4. For mutating endpoints (POST /scan, POST /cartridges,
        //      DELETE /cartridges/:id, POST /remediate, POST /remediation-profiles),
        //      integrate @backstage/plugin-permission-node and gate behind
        //      catalogEntityCreatePermission (or a custom compliance permission).
        //   5. Frontend already passes x-aap-token header via
        //      ComplianceBackendClient; per-request AAP tokens are wired
        //      through getUserAapToken() in router.ts.

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

        // --- Mutating endpoints (TODO: gate behind permissions in production) ---
        httpRouter.addAuthPolicy({ path: '/scan', allow: 'unauthenticated' });
        httpRouter.addAuthPolicy({ path: '/remediate', allow: 'unauthenticated' });
        httpRouter.addAuthPolicy({ path: '/remediation-profiles', allow: 'unauthenticated' });
        httpRouter.addAuthPolicy({ path: '/remediation-profiles/:id', allow: 'unauthenticated' });
      },
    });
  },
});
