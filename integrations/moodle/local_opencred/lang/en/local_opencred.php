<?php
/**
 * English strings.
 *
 * @package    local_opencred
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'OpenCred credentials';

$string['connection'] = 'Connection';
$string['connection_desc'] =
    'Connect this Moodle site to an OpenCred installation. OpenCred can be the hosted service or ' .
    'your own self-hosted instance — the plugin does not care which.';

$string['enabled'] = 'Issue credentials on course completion';
$string['enabled_desc'] =
    'When enabled, completing a mapped course queues a credential for the student. Issuing happens ' .
    'on cron, so student page loads are never delayed by it.';

$string['apiurl'] = 'API base URL';
$string['apiurl_desc'] = 'For example https://credentials.your-institution.edu';

$string['apikey'] = 'API key';
$string['apikey_desc'] =
    'Create one in OpenCred under Settings → API keys. An "issuer" key is sufficient; do not use ' .
    'an admin key here.';

$string['mappings'] = 'Course mappings';
$string['mappings_desc'] = 'Choose which template each course issues: <a href="{$a}">manage mappings</a>.';
$string['addmapping'] = 'Add a mapping';
$string['mappingsaved'] = 'Mapping saved.';
$string['mappingdeleted'] = 'Mapping removed.';
$string['nomappings'] = 'No courses are mapped yet, so nothing will be issued.';

$string['template'] = 'Template';
$string['expiry'] = 'Expiry';
$string['expiresmonths'] = 'Expires after (months, 0 for never)';
$string['expiresinmonths'] = '{$a} months';
$string['never'] = 'Never';
$string['sendemail'] = 'Email the credential to the student';
$string['deletedcourse'] = 'Deleted course';

$string['connectedas'] = 'Connected to OpenCred workspace: {$a}';
$string['connectionfailed'] = 'Could not reach OpenCred: {$a}';
$string['notconfigured'] = 'Set the API base URL and API key in the plugin settings first.';
$string['apierror'] = 'OpenCred API error: {$a}';

$string['taskissuecredential'] = 'Issue an OpenCred credential';
$string['criterianarrative'] = 'Awarded on completion of {$a} in Moodle.';

$string['local/opencred:managemappings'] = 'Manage OpenCred course mappings';

$string['privacy:metadata:opencred'] =
    'Credential data is sent to the configured OpenCred installation so that credentials can be ' .
    'issued and verified.';
$string['privacy:metadata:opencred:fullname'] = 'The student full name, printed on the credential.';
$string['privacy:metadata:opencred:email'] = 'The student email address, used to deliver the credential.';
$string['privacy:metadata:opencred:idnumber'] = 'The student ID number, used to de-duplicate recipients.';
$string['privacy:metadata:opencred:grade'] = 'The final course grade, where the template shows one.';
$string['privacy:metadata:local_opencred_issued'] = 'A local record of which credentials this site issued.';
$string['privacy:metadata:local_opencred_issued:userid'] = 'The user the credential was issued to.';
$string['privacy:metadata:local_opencred_issued:courseid'] = 'The course that was completed.';
$string['privacy:metadata:local_opencred_issued:publicid'] = 'The public credential identifier.';
$string['privacy:metadata:local_opencred_issued:timecreated'] = 'When the credential was issued.';
