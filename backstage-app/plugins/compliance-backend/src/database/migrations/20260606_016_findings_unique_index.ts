import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('compliance_findings', table => {
    table.unique(['scan_id', 'rule_id', 'host']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('compliance_findings', table => {
    table.dropUnique(['scan_id', 'rule_id', 'host']);
  });
}
