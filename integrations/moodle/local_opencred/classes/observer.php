<?php
/**
 * Event observers.
 *
 * @package    local_opencred
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_opencred;

defined('MOODLE_INTERNAL') || die();

/**
 * Reacts to Moodle completion events.
 */
class observer {

    /**
     * A student completed a course.
     *
     * This handler does as little as possible and then queues an adhoc task.
     * Event observers run inside the request that triggered them — often a
     * student clicking "submit" on their last quiz — and an HTTP call to an
     * external service from there would make that click hang, or fail the
     * completion transaction if the network is slow.
     *
     * @param \core\event\course_completed $event
     */
    public static function course_completed(\core\event\course_completed $event): void {
        global $DB;

        if (!get_config('local_opencred', 'enabled')) {
            return;
        }

        $courseid = (int) $event->courseid;
        $userid = (int) $event->relateduserid;

        $mapping = $DB->get_record('local_opencred_map', ['courseid' => $courseid, 'enabled' => 1]);
        if (!$mapping) {
            return;
        }

        // The unique (courseid, userid) index makes this the real duplicate
        // guard; the check is only here to avoid a noisy exception in the log
        // for the common case of completion being recalculated.
        if ($DB->record_exists('local_opencred_issued', ['courseid' => $courseid, 'userid' => $userid])) {
            return;
        }

        $DB->insert_record('local_opencred_issued', (object) [
            'courseid'    => $courseid,
            'userid'      => $userid,
            'status'      => 'pending',
            'timecreated' => time(),
        ]);

        $task = new \local_opencred\task\issue_credential();
        $task->set_custom_data((object) [
            'courseid' => $courseid,
            'userid'   => $userid,
        ]);
        \core\task\manager::queue_adhoc_task($task, true);
    }
}
