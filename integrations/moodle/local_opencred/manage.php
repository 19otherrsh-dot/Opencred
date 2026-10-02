<?php
/**
 * Course-to-template mapping screen.
 *
 * @package    local_opencred
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/adminlib.php');

admin_externalpage_setup('local_opencred');
require_capability('local/opencred:managemappings', context_system::instance());

$PAGE->set_url(new moodle_url('/local/opencred/manage.php'));
$PAGE->set_title(get_string('mappings', 'local_opencred'));
$PAGE->set_heading(get_string('mappings', 'local_opencred'));

$client = new \local_opencred\client();

$delete = optional_param('delete', 0, PARAM_INT);
if ($delete && confirm_sesskey()) {
    $DB->delete_records('local_opencred_map', ['id' => $delete]);
    redirect($PAGE->url, get_string('mappingdeleted', 'local_opencred'));
}

$courseid = optional_param('courseid', 0, PARAM_INT);
$templateid = optional_param('templateid', '', PARAM_ALPHANUMEXT);
$expiresmonths = optional_param('expiresmonths', 0, PARAM_INT);
$sendemail = optional_param('sendemail', 1, PARAM_INT);

if ($courseid && $templateid && confirm_sesskey()) {
    $existing = $DB->get_record('local_opencred_map', ['courseid' => $courseid]);
    $record = (object) [
        'courseid'      => $courseid,
        'templateid'    => $templateid,
        'enabled'       => 1,
        'expiresmonths' => $expiresmonths ?: null,
        'sendemail'     => $sendemail ? 1 : 0,
        'timemodified'  => time(),
    ];

    if ($existing) {
        $record->id = $existing->id;
        $DB->update_record('local_opencred_map', $record);
    } else {
        $DB->insert_record('local_opencred_map', $record);
    }

    redirect($PAGE->url, get_string('mappingsaved', 'local_opencred'));
}

echo $OUTPUT->header();

if (!$client->is_configured()) {
    echo $OUTPUT->notification(get_string('notconfigured', 'local_opencred'), 'error');
    echo $OUTPUT->footer();
    exit;
}

// A failed connection here is the single most common support case, so it is
// reported in full rather than swallowed into an empty dropdown.
try {
    $templates = $client->templates();
    $whoami = $client->whoami();
    echo $OUTPUT->notification(
        get_string('connectedas', 'local_opencred', s($whoami['organization']['name'] ?? 'unknown')),
        'success'
    );
} catch (\Throwable $e) {
    echo $OUTPUT->notification(
        get_string('connectionfailed', 'local_opencred', s($e->getMessage())),
        'error'
    );
    echo $OUTPUT->footer();
    exit;
}

$mappings = $DB->get_records('local_opencred_map');

$table = new html_table();
$table->head = [
    get_string('course'),
    get_string('template', 'local_opencred'),
    get_string('expiry', 'local_opencred'),
    get_string('email'),
    '',
];

foreach ($mappings as $mapping) {
    $course = $DB->get_record('course', ['id' => $mapping->courseid], 'id, fullname', IGNORE_MISSING);
    $templatename = $mapping->templateid;
    foreach ($templates as $template) {
        if ($template['id'] === $mapping->templateid) {
            $templatename = $template['name'];
            break;
        }
    }

    $deleteurl = new moodle_url($PAGE->url, ['delete' => $mapping->id, 'sesskey' => sesskey()]);

    $table->data[] = [
        $course ? format_string($course->fullname) : get_string('deletedcourse', 'local_opencred'),
        s($templatename),
        $mapping->expiresmonths
            ? get_string('expiresinmonths', 'local_opencred', $mapping->expiresmonths)
            : get_string('never', 'local_opencred'),
        $mapping->sendemail ? get_string('yes') : get_string('no'),
        html_writer::link($deleteurl, get_string('delete')),
    ];
}

if (empty($table->data)) {
    echo $OUTPUT->notification(get_string('nomappings', 'local_opencred'), 'info');
} else {
    echo html_writer::table($table);
}

echo $OUTPUT->heading(get_string('addmapping', 'local_opencred'), 3);

$courses = $DB->get_records_select(
    'course',
    'id <> :siteid',
    ['siteid' => SITEID],
    'fullname ASC',
    'id, fullname',
    0,
    500
);

echo html_writer::start_tag('form', ['method' => 'post', 'action' => $PAGE->url->out(false)]);
echo html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);

$courseoptions = [];
foreach ($courses as $course) {
    $courseoptions[$course->id] = format_string($course->fullname);
}

$templateoptions = [];
foreach ($templates as $template) {
    $templateoptions[$template['id']] = $template['name'] . ' (' . $template['kind'] . ')';
}

echo html_writer::div(
    html_writer::label(get_string('course'), 'courseid') .
    html_writer::select($courseoptions, 'courseid', '', false, ['id' => 'courseid'])
);

echo html_writer::div(
    html_writer::label(get_string('template', 'local_opencred'), 'templateid') .
    html_writer::select($templateoptions, 'templateid', '', false, ['id' => 'templateid'])
);

echo html_writer::div(
    html_writer::label(get_string('expiresmonths', 'local_opencred'), 'expiresmonths') .
    html_writer::empty_tag('input', [
        'type' => 'number',
        'name' => 'expiresmonths',
        'id' => 'expiresmonths',
        'min' => 0,
        'value' => 0,
    ])
);

echo html_writer::div(
    html_writer::checkbox('sendemail', 1, true, get_string('sendemail', 'local_opencred'))
);

echo html_writer::empty_tag('input', [
    'type' => 'submit',
    'class' => 'btn btn-primary',
    'value' => get_string('savechanges'),
]);

echo html_writer::end_tag('form');

echo $OUTPUT->footer();
