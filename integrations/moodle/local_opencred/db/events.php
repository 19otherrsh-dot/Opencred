<?php
/**
 * Event observers.
 *
 * `course_completed` is the event that matters: it fires once, when Moodle's
 * completion engine has decided a student is finished, which is precisely the
 * moment a certificate should exist.
 *
 * `course_module_completion_updated` is deliberately NOT observed. It fires
 * many times per student per course, and issuing from it would produce a
 * certificate per activity.
 *
 * @package    local_opencred
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$observers = [
    [
        'eventname'   => '\core\event\course_completed',
        'callback'    => '\local_opencred\observer::course_completed',
        'internal'    => false,
        'priority'    => 100,
    ],
];
