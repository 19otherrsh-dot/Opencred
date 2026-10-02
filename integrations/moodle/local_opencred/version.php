<?php
// This file is part of the OpenCred Moodle plugin.
//
// OpenCred is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software
// Foundation, either version 3 of the License, or (at your option) any later
// version. Moodle plugins must be GPLv3+, which is compatible with the AGPLv3
// core platform.

/**
 * Plugin version and requirements.
 *
 * @package    local_opencred
 * @copyright  OpenCred contributors
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$plugin->component = 'local_opencred';
$plugin->version   = 2026082100;
// Moodle 4.1 LTS. Chosen because it is the version institutions are actually
// running, not the newest release.
$plugin->requires  = 2022112800;
$plugin->maturity  = MATURITY_STABLE;
$plugin->release   = '1.0.0';
