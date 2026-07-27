export interface Config {
  ansible?: {
    compliance?: {
      /**
       * Enables or disables the compliance plugin (ADR-011).
       * @visibility frontend
       */
      enabled?: boolean;

      /**
       * Data source: 'mock' for sample data, 'live' for real AAP.
       * @visibility backend
       */
      dataSource?: string;

      /**
       * Auth mode: 'production' for RBAC, 'development' for guest access.
       * @visibility backend
       */
      authMode?: string;

      /**
       * Days to retain scan findings before cleanup.
       * @visibility backend
       */
      retentionDays?: number;
    };
  };
}
