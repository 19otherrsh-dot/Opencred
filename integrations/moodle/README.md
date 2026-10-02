# OpenCred for Moodle

Issues a signed, verifiable credential when a student completes a course.

This is the reference LMS connector (FR-INT-04). It is deliberately open source
and deliberately small: an institution's Moodle administrator should be able to
read the whole thing before installing it, and extend it without asking us.

## What it does

When Moodle fires `\core\event\course_completed` for a mapped course, the plugin
records the completion locally and queues an adhoc task. The task calls the
OpenCred API, which signs, renders and (optionally) emails the credential.

## Why it works the way it does

**Issuance happens on cron, not in the request.** Event observers run inside the
request that triggered them — usually a student submitting their final activity.
Calling an external HTTP API from there would make that click hang on somebody
else's network, and a timeout could fail the completion transaction. The task
queue is the correct place for this, and it also gives us Moodle's own retry
behaviour for free.

**Every issuance carries an idempotency key** of the form
`moodle-<courseid>-<userid>`. Moodle recalculates completion more often than
people expect, and adhoc tasks retry. Without a stable key, a student would
receive several certificates for one course, and the first they would hear about
it is a confused email. The plugin also holds a unique index on
`(courseid, userid)` as a second guard.

**The API base URL is a setting, not a constant.** Most institutions running
Moodle are exactly the institutions that will self-host OpenCred. A connector
hard-wired to a vendor's domain would be useless to them.

## Installing

```bash
# From your Moodle root
cp -r integrations/moodle/local_opencred /path/to/moodle/local/opencred
```

Then visit **Site administration → Notifications** to run the install, and
**Site administration → Plugins → Local plugins → OpenCred credentials** to
configure it.

1. Create an API key in OpenCred (**Settings → API keys**). An `issuer` key is
   enough — it can issue and revoke and nothing else. Do not use an admin key.
2. Paste the API base URL and the key.
3. Tick **Issue credentials on course completion**.
4. Open **Manage mappings** and map each course to a template.

The mapping screen calls the API on load and reports the workspace it connected
to, so a wrong key or an unreachable host shows up immediately rather than as
silently missing certificates.

## Requirements

- Moodle 4.1 or later
- Course completion enabled on the courses you map
- Cron running (it is required by Moodle anyway)

## What data leaves Moodle

Full name, email address, ID number, and the final course grade where the
template displays one. This is declared in the plugin's privacy provider, so it
appears in Moodle's own privacy registry for your DPO to review.

## Licence

GPL-3.0-or-later, as Moodle plugins must be. Compatible with the AGPLv3 core
platform.
