import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('compliance_remediation_executions', table => {
    table.text('error_details').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('compliance_remediation_executions', table => {
    table.dropColumn('error_details');
  });
}
