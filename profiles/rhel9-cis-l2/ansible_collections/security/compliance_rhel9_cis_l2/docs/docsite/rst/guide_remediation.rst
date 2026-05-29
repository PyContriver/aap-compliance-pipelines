.. _ansible_collections.security.compliance_rhel9_cis_l2.docsite.guide_remediation:

*********************************************
Remediation Guide: CIS Level 2 - Server
*********************************************

Overview
========

Remediation uses the ComplianceAsCode (CaC) playbook shipped with
``scap-security-guide`` inside the Execution Environment. The playbook
contains per-rule tagged tasks for all CIS Level 2 rules (which includes
all Level 1 rules).

The remediation playbook is:

.. code-block:: text

   /usr/share/scap-security-guide/ansible/rhel9-playbook-cis.yml

Running Remediation
===================

Via Automation Controller
-------------------------

The compliance plugin backend launches remediation as a direct job template
(not as part of a workflow). The job template must have:

- ``ask_tags_on_launch: true`` -- The plugin passes selected rule IDs as ``job_tags``
- ``ask_variables_on_launch: true`` -- For CaC parameter overrides
- ``ask_inventory_on_launch: true`` -- To scope remediation to specific hosts

Via CLI
-------

.. code-block:: bash

   # Remediate all CIS L2 rules
   ansible-playbook security.compliance_rhel9_cis_l2.remediate \
     -i inventory.yml --become

   # Remediate specific rules using tags
   ansible-playbook security.compliance_rhel9_cis_l2.remediate \
     -i inventory.yml --become \
     --tags sshd_set_keepalive_0,audit_rules_file_deletion_events

   # Remediate with parameter overrides
   ansible-playbook security.compliance_rhel9_cis_l2.remediate \
     -i inventory.yml --become \
     --tags accounts_tmout \
     -e var_accounts_tmout=900

Scoping Remediation with job_tags
=================================

Each CaC task in the remediation playbook is tagged with the rule ID (the short
form without the XCCDF prefix). The ``normalize_xccdf`` module strips the
``xccdf_org.ssgproject.content_rule_`` prefix from rule IDs so they match
the CaC tags exactly.

For example:

.. list-table::
   :header-rows: 1
   :widths: 40 30 30

   * - XCCDF Rule ID
     - CaC Tag
     - job_tags Value
   * - ``xccdf_org.ssgproject.content_rule_sshd_set_keepalive_0``
     - ``sshd_set_keepalive_0``
     - ``sshd_set_keepalive_0``

Parameter Overrides
===================

Many CaC rules accept variables to customize thresholds and values. These are
passed as extra vars through the job template's ``ask_variables_on_launch``
setting.

Common CIS parameter overrides:

.. list-table::
   :header-rows: 1
   :widths: 35 15 50

   * - Variable
     - Default
     - Description
   * - ``var_accounts_tmout``
     - 600
     - Shell timeout in seconds
   * - ``var_password_pam_minlen``
     - 14
     - Minimum password length
   * - ``var_password_pam_retry``
     - 3
     - Password retry attempts
   * - ``var_accounts_maximum_age_login_defs``
     - 365
     - Maximum password age in days
   * - ``var_accounts_minimum_age_login_defs``
     - 1
     - Minimum password age in days
   * - ``var_authselect_profile``
     - sssd
     - Authselect profile to use

Content Lifecycle
=================

The CaC remediation playbook is maintained by Red Hat as part of the
``scap-security-guide`` RPM. When CIS publishes benchmark updates:

1. Red Hat updates the ``scap-security-guide`` RPM
2. Rebuild the EE to pick up new remediation content
3. New rules and updated fix tasks are available immediately

No collection update or plugin redeploy is needed.

Verifying Remediation
=====================

After remediation, re-run the assessment to verify that remediated rules now
pass:

.. code-block:: bash

   ansible-playbook security.compliance_rhel9_cis_l2.run_oscap \
     -i inventory.yml --become

Compare the before and after findings to confirm that targeted rules changed
from ``fail`` to ``pass``.
