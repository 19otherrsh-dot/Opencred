<?php
/**
 * Site administration settings.
 *
 * @package    local_opencred
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_opencred', get_string('pluginname', 'local_opencred'));

    $settings->add(new admin_setting_heading(
        'local_opencred/connection',
        get_string('connection', 'local_opencred'),
        get_string('connection_desc', 'local_opencred')
    ));

    $settings->add(new admin_setting_configcheckbox(
        'local_opencred/enabled',
        get_string('enabled', 'local_opencred'),
        get_string('enabled_desc', 'local_opencred'),
        0
    ));

    $settings->add(new admin_setting_configtext(
        'local_opencred/apiurl',
        get_string('apiurl', 'local_opencred'),
        get_string('apiurl_desc', 'local_opencred'),
        '',
        PARAM_URL
    ));

    $settings->add(new admin_setting_configpasswordunmask(
        'local_opencred/apikey',
        get_string('apikey', 'local_opencred'),
        get_string('apikey_desc', 'local_opencred'),
        ''
    ));

    $settings->add(new admin_setting_heading(
        'local_opencred/mappings',
        get_string('mappings', 'local_opencred'),
        get_string(
            'mappings_desc',
            'local_opencred',
            (new moodle_url('/local/opencred/manage.php'))->out()
        )
    ));

    $ADMIN->add('localplugins', $settings);
}
