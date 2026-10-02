<?php
/**
 * Adhoc task that issues one credential.
 *
 * @package    local_opencred
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_opencred\task;

defined('MOODLE_INTERNAL') || die();

/**
 * Issues a credential for one completed enrolment.
 *
 * Runs on the Moodle cron, out of band from the student's request. Failures
 * throw, which is what makes Moodle retry the task with its own backoff —
 * a transient network problem should not silently cost someone their
 * certificate.
 */
class issue_credential extends \core\task\adhoc_task {

    public function get_name(): string {
        return get_string('taskissuecredential', 'local_opencred');
    }

    public function execute(): void {
        global $DB;

        $data = $this->get_custom_data();
        $courseid = (int) $data->courseid;
        $userid = (int) $data->userid;

        $mapping = $DB->get_record('local_opencred_map', ['courseid' => $courseid, 'enabled' => 1]);
        if (!$mapping) {
            mtrace("local_opencred: course {$courseid} is no longer mapped, skipping");
            return;
        }

        $user = $DB->get_record('user', ['id' => $userid], '*', IGNORE_MISSING);
        $course = $DB->get_record('course', ['id' => $courseid], '*', IGNORE_MISSING);

        if (!$user || !$course) {
            mtrace("local_opencred: user or course missing, skipping");
            return;
        }

        if ($user->deleted || $user->suspended || empty($user->email)) {
            mtrace("local_opencred: user {$userid} is not deliverable, skipping");
            return;
        }

        $completion = $DB->get_record(
            'course_completions',
            ['course' => $courseid, 'userid' => $userid],
            '*',
            IGNORE_MISSING
        );

        $grade = $this->final_grade($courseid, $userid);

        $payload = [
            'templateId' => $mapping->templateid,
            'recipient'  => [
                'name'       => fullname($user),
                'email'      => $user->email,
                // Moodle's idnumber is the registrar's own identifier where one
                // exists; falling back to the internal id keeps de-duplication
                // working on sites that do not populate it.
                'externalId' => $user->idnumber !== '' ? $user->idnumber : 'moodle-' . $user->id,
            ],
            'title' => format_string($course->fullname),
            'data'  => array_filter([
                'course' => format_string($course->fullname),
                'grade'  => $grade,
            ], static fn($value) => $value !== null && $value !== ''),
            'achievement' => [
                'achievementType'   => 'CertificateOfCompletion',
                'criteriaNarrative' => get_string(
                    'criterianarrative',
                    'local_opencred',
                    format_string($course->fullname)
                ),
                'criteriaUrl' => (new \moodle_url('/course/view.php', ['id' => $courseid]))->out(false),
            ],
            'issuedAt' => $completion && $completion->timecompleted
                ? date('c', (int) $completion->timecompleted)
                : date('c'),
            'suppressEmail' => empty($mapping->sendemail),
            // The stable key: the same student completing the same course is
            // always the same credential, however many times this task runs.
            'idempotencyKey' => "moodle-{$courseid}-{$userid}",
        ];

        if (!empty($mapping->expiresmonths)) {
            $payload['expiresAt'] = date('c', strtotime('+' . (int) $mapping->expiresmonths . ' months'));
        }

        $record = $DB->get_record('local_opencred_issued', ['courseid' => $courseid, 'userid' => $userid]);

        try {
            $client = new \local_opencred\client();
            $result = $client->issue($payload);

            if ($record) {
                $record->status = 'issued';
                $record->publicid = $result['publicId'] ?? null;
                $record->credentialid = $result['id'] ?? null;
                $record->error = null;
                $DB->update_record('local_opencred_issued', $record);
            }

            mtrace("local_opencred: issued {$result['publicId']} to {$user->email}");
        } catch (\Throwable $e) {
            if ($record) {
                $record->status = 'failed';
                $record->error = $e->getMessage();
                $DB->update_record('local_opencred_issued', $record);
            }
            // Rethrown so Moodle retries the adhoc task.
            throw $e;
        }
    }

    /**
     * The student's final course grade, formatted for display, or null.
     *
     * @param int $courseid
     * @param int $userid
     * @return string|null
     */
    private function final_grade(int $courseid, int $userid): ?string {
        global $CFG;
        require_once($CFG->libdir . '/gradelib.php');

        $grades = grade_get_course_grades($courseid, [$userid]);
        if (empty($grades->grades[$userid])) {
            return null;
        }

        $grade = $grades->grades[$userid];
        if ($grade->grade === null || $grade->grade === '') {
            return null;
        }

        return (string) ($grade->str_grade ?? $grade->grade);
    }
}
