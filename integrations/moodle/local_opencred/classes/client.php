<?php
/**
 * OpenCred API client.
 *
 * @package    local_opencred
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_opencred;

defined('MOODLE_INTERNAL') || die();

/**
 * Thin HTTP client over the OpenCred REST API.
 *
 * Uses Moodle's own curl wrapper rather than raw curl, because that wrapper is
 * what respects the site's proxy configuration and its outbound-host allow-list
 * — both of which matter on the locked-down networks universities actually run.
 */
class client {

    /** @var string API base URL, without a trailing slash. */
    private $baseurl;

    /** @var string API key. */
    private $apikey;

    public function __construct(?string $baseurl = null, ?string $apikey = null) {
        $this->baseurl = rtrim($baseurl ?? (string) get_config('local_opencred', 'apiurl'), '/');
        $this->apikey = $apikey ?? (string) get_config('local_opencred', 'apikey');
    }

    /**
     * Whether the plugin has enough configuration to do anything.
     */
    public function is_configured(): bool {
        return $this->baseurl !== '' && $this->apikey !== '';
    }

    /**
     * Issue a credential.
     *
     * @param array $payload Issue request body.
     * @return array Decoded response.
     * @throws \moodle_exception on any non-2xx response.
     */
    public function issue(array $payload): array {
        return $this->request('POST', '/v1/credentials', $payload);
    }

    /**
     * List the templates available to this API key.
     *
     * @return array
     */
    public function templates(): array {
        return $this->request('GET', '/v1/templates');
    }

    /**
     * Confirm the API key works and report which workspace it belongs to.
     *
     * @return array
     */
    public function whoami(): array {
        return $this->request('GET', '/v1/auth/me');
    }

    /**
     * @param string $method
     * @param string $path
     * @param array|null $body
     * @return array
     * @throws \moodle_exception
     */
    private function request(string $method, string $path, ?array $body = null): array {
        if (!$this->is_configured()) {
            throw new \moodle_exception('notconfigured', 'local_opencred');
        }

        $curl = new \curl();
        $curl->setHeader([
            'Authorization: Bearer ' . $this->apikey,
            'Content-Type: application/json',
            'Accept: application/json',
            'User-Agent: local_opencred/1.0 (Moodle)',
        ]);

        $options = [
            'CURLOPT_TIMEOUT' => 30,
            'CURLOPT_CONNECTTIMEOUT' => 10,
            'CURLOPT_FOLLOWLOCATION' => 0,
        ];

        $url = $this->baseurl . $path;
        $encoded = $body === null ? null : json_encode($body, JSON_UNESCAPED_SLASHES);

        switch ($method) {
            case 'POST':
                $response = $curl->post($url, $encoded, $options);
                break;
            case 'GET':
            default:
                $response = $curl->get($url, [], $options);
                break;
        }

        $info = $curl->get_info();
        $status = (int) ($info['http_code'] ?? 0);

        if ($curl->get_errno()) {
            throw new \moodle_exception(
                'apierror',
                'local_opencred',
                '',
                'network error: ' . $curl->error
            );
        }

        $decoded = json_decode((string) $response, true);

        if ($status < 200 || $status >= 300) {
            $message = is_array($decoded) && isset($decoded['message'])
                ? $decoded['message']
                : 'HTTP ' . $status;
            throw new \moodle_exception('apierror', 'local_opencred', '', $message);
        }

        return is_array($decoded) ? $decoded : [];
    }
}
