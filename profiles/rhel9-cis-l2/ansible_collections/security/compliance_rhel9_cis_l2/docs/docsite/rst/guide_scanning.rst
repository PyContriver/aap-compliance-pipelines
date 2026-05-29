.. _ansible_collections.security.compliance_rhel9_cis_l2.docsite.guide_scanning:

*********************************************
Scanning Guide: CIS Level 2 - Server
*********************************************

Running an Assessment
=====================

The assessment playbook ``playbooks/run_oscap.yml`` performs a complete scan and
normalization cycle in a single job template.

Prerequisites
-------------

- An Execution Environment with ``scap-security-guide`` and ``openscap-scanner``
  installed (build from ``meta/execution-environment.yml``)
- Target hosts running RHEL 9 with SSH access and ``become`` privileges
- Target hosts must have ``dnf`` available (OpenSCAP is installed ephemerally
  if not already present)

Quick Start
-----------

.. code-block:: bash

   ansible-playbook security.compliance_rhel9_cis_l2.run_oscap \
     -i inventory.yml \
     --become

Playbook Variables
------------------

.. list-table::
   :header-rows: 1
   :widths: 25 30 45

   * - Variable
     - Default
     - Description
   * - ``target_hosts``
     - ``all``
     - Ansible host pattern for scan targets
   * - ``oscap_profile``
     - ``xccdf_org.ssgproject.content_profile_cis``
     - XCCDF profile ID to evaluate against
   * - ``oscap_xccdf_profile``
     - *(unset)*
     - Override for ``oscap_profile`` via extra vars
   * - ``ssg_datastream_ee_path``
     - ``/usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml``
     - Path to the SCAP datastream inside the EE
   * - ``target_results_dir``
     - ``/tmp/compliance-scan``
     - Temporary directory on targets for scan results
   * - ``fetch_dest_dir``
     - ``/tmp/compliance-results``
     - Directory on the execution node for fetched results
   * - ``output_file``
     - ``/tmp/compliance_report.json``
     - Path for the CFF JSON output (Play 2)

Direct POST Variables (Backstage Integration)
---------------------------------------------

When the compliance plugin backend launches the assessment, it provides these
extra vars to enable direct findings ingestion:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Variable
     - Description
   * - ``backstage_api_url``
     - Base URL of the Backstage instance
   * - ``scan_id``
     - UUID of the scan record in the compliance plugin database
   * - ``ingest_token``
     - Per-scan security token for the ``/findings/ingest`` endpoint

What Happens During a Scan
--------------------------

**Play 1 (runs on target hosts):**

1. Checks if ``openscap-scanner`` is installed
2. Installs it via ``dnf`` if missing, sets a cleanup flag
3. Copies the SCAP datastream from the EE to the target
4. Runs ``oscap xccdf eval --profile <profile> --results <results.xml> <datastream>``
5. Fetches the XCCDF results XML back to the execution node
6. Removes the datastream, scan results, and OpenSCAP (if installed by this scan)

**Play 2 (runs on localhost in the same container):**

1. Finds all fetched ``xccdf-results-*.xml`` files
2. Calls the ``normalize_xccdf`` module for each host's results individually
3. If ``backstage_api_url`` is set, POSTs combined findings to the plugin API
4. Reports summary counts (pass/fail/error)

OpenSCAP Exit Codes
-------------------

.. list-table::
   :header-rows: 1
   :widths: 10 30 60

   * - Code
     - Meaning
     - Playbook behavior
   * - 0
     - All rules pass
     - Task succeeds
   * - 2
     - Some rules fail
     - Task succeeds (expected for most hosts)
   * - 1
     - Scanner error
     - Task fails

Standalone Normalization
------------------------

The ``playbooks/normalize.yml`` playbook can re-process previously fetched XCCDF
XML without re-running the scan:

.. code-block:: bash

   ansible-playbook security.compliance_rhel9_cis_l2.normalize \
     -e results_dir=/path/to/xccdf-results \
     -e output_file=/tmp/report.json

Module Usage
------------

The ``normalize_xccdf`` module can be used directly in custom playbooks:

.. code-block:: yaml

   - name: Normalize XCCDF results
     security.compliance_rhel9_cis_l2.normalize_xccdf:
       results_files:
         - /tmp/xccdf-results-webserver01.xml
         - /tmp/xccdf-results-dbserver01.xml
       output_file: /tmp/compliance-report.json
       profile_name: "CIS Benchmark RHEL 9 Level 2 - Server"
       framework: "CIS"
     register: normalized
