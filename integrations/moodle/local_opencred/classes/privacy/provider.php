<?php
/**
 * Privacy provider.
 *
 * @package    local_opencred
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_opencred\privacy;

defined('MOODLE_INTERNAL') || die();

use core_privacy\local\metadata\collection;
use core_privacy\local\request\approved_contextlist;
use core_privacy\local\request\approved_userlist;
use core_privacy\local\request\contextlist;
use core_privacy\local\request\transform;
use core_privacy\local\request\userlist;
use core_privacy\local\request\writer;

/**
 * Declares what this plugin stores locally and what it sends to OpenCred.
 *
 * Moodle requires this of every plugin that touches user data, and the
 * external-location declaration is the part that matters here: an institution's
 * DPO needs to see, in Moodle's own privacy registry, that names, addresses and
 * grades leave the site for the configured credentialing service.
 */
class provider implements
    \core_privacy\local\metadata\provider,
    \core_privacy\local\request\core_userlist_provider,
    \core_privacy\local\request\plugin\provider {

    public static function get_metadata(collection $collection): collection {
        $collection->add_external_location_link(
            'opencred',
            [
                'fullname' => 'privacy:metadata:opencred:fullname',
                'email'    => 'privacy:metadata:opencred:email',
                'idnumber' => 'privacy:metadata:opencred:idnumber',
                'grade'    => 'privacy:metadata:opencred:grade',
            ],
            'privacy:metadata:opencred'
        );

        $collection->add_database_table(
            'local_opencred_issued',
            [
                'userid'      => 'privacy:metadata:local_opencred_issued:userid',
                'courseid'    => 'privacy:metadata:local_opencred_issued:courseid',
                'publicid'    => 'privacy:metadata:local_opencred_issued:publicid',
                'timecreated' => 'privacy:metadata:local_opencred_issued:timecreated',
            ],
            'privacy:metadata:local_opencred_issued'
        );

        return $collection;
    }

    public static function get_contexts_for_userid(int $userid): contextlist {
        $contextlist = new contextlist();
        $contextlist->add_from_sql(
            'SELECT ctx.id
               FROM {local_opencred_issued} i
               JOIN {context} ctx ON ctx.instanceid = i.courseid AND ctx.contextlevel = :courselevel
              WHERE i.userid = :userid',
            ['courselevel' => CONTEXT_COURSE, 'userid' => $userid]
        );
        return $contextlist;
    }

    public static function get_users_in_context(userlist $userlist): void {
        $context = $userlist->get_context();
        if (!$context instanceof \context_course) {
            return;
        }

        $userlist->add_from_sql(
            'userid',
            'SELECT userid FROM {local_opencred_issued} WHERE courseid = :courseid',
            ['courseid' => $context->instanceid]
        );
    }

    public static function export_user_data(approved_contextlist $contextlist): void {
        global $DB;

        foreach ($contextlist->get_contexts() as $context) {
            if (!$context instanceof \context_course) {
                continue;
            }

            $records = $DB->get_records('local_opencred_issued', [
                'courseid' => $context->instanceid,
                'userid'   => $contextlist->get_user()->id,
            ]);

            foreach ($records as $record) {
                writer::with_context($context)->export_data(
                    [get_string('pluginname', 'local_opencred')],
                    (object) [
                        'publicid'    => $record->publicid,
                        'status'      => $record->status,
                        'timecreated' => transform::datetime($record->timecreated),
                    ]
                );
            }
        }
    }

    public static function delete_data_for_all_users_in_context(\context $context): void {
        global $DB;
        if ($context instanceof \context_course) {
            $DB->delete_records('local_opencred_issued', ['courseid' => $context->instanceid]);
        }
    }

    public static function delete_data_for_user(approved_contextlist $contextlist): void {
        global $DB;

        foreach ($contextlist->get_contexts() as $context) {
            if (!$context instanceof \context_course) {
                continue;
            }
            $DB->delete_records('local_opencred_issued', [
                'courseid' => $context->instanceid,
                'userid'   => $contextlist->get_user()->id,
            ]);
        }
    }

    public static function delete_data_for_users(approved_userlist $userlist): void {
        global $DB;

        $context = $userlist->get_context();
        if (!$context instanceof \context_course) {
            return;
        }

        [$insql, $inparams] = $DB->get_in_or_equal($userlist->get_userids(), SQL_PARAMS_NAMED);
        $DB->delete_records_select(
            'local_opencred_issued',
            "courseid = :courseid AND userid {$insql}",
            array_merge(['courseid' => $context->instanceid], $inparams)
        );
    }
}
