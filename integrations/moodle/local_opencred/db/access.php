<?php
/**
 * Capability definitions.
 *
 * @package    local_opencred
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$capabilities = [
    'local/opencred:managemappings' => [
        // Deciding which course issues which credential is a policy decision
        // about what the institution certifies, so it is deliberately kept at
        // manager level rather than given to every course editor.
        'riskbitmask'  => RISK_CONFIG,
        'captype'      => 'write',
        'contextlevel' => CONTEXT_SYSTEM,
        'archetypes'   => [
            'manager' => CAP_ALLOW,
        ],
    ],
];
