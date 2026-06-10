<?php
/**
 * Audit module. Runs a structured set of checks against the WP install and
 * pushes findings to the platform via the existing site-heartbeat endpoint
 * (under a new `findings` array). Each finding has a stable finding_key so
 * the platform can dedupe across runs and auto-resolve issues that disappear.
 *
 * Designed to run on a daily cron (default audit_interval_hours = 24).
 */

if (!defined('ABSPATH')) { exit; }

// Queue for findings (kept per-run, not persisted).
global $mithras_soc_finding_queue, $mithras_soc_audit_keys_current;
$mithras_soc_finding_queue        = [];
$mithras_soc_audit_keys_current   = [];

function mithras_soc_finding(string $key, string $category, string $severity, string $title, ?string $description = null, ?string $recommendation = null, ?array $evidence = null): void {
    global $mithras_soc_finding_queue, $mithras_soc_audit_keys_current;
    $mithras_soc_finding_queue[] = [
        'finding_key'   => $key,
        'category'      => $category,
        'severity'      => $severity,
        'title'         => $title,
        'description'   => $description,
        'recommendation'=> $recommendation,
        'evidence'      => $evidence,
    ];
    $mithras_soc_audit_keys_current[] = $key;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function mithras_soc_audit_core_version(): void {
    global $wp_version;
    $resp = wp_remote_get('https://api.wordpress.org/core/version-check/1.7/', ['timeout' => 10]);
    if (is_wp_error($resp)) return;
    $data = json_decode(wp_remote_retrieve_body($resp), true);
    $latest = $data['offers'][0]['current'] ?? null;
    if ($latest && version_compare($wp_version, $latest, '<')) {
        // Minor / patch drift = info; minor branch behind = warning; major
        // branch behind = error.
        $cur_parts = explode('.', $wp_version);
        $new_parts = explode('.', $latest);
        $cur_major = (int)($cur_parts[0] ?? 0); $new_major = (int)($new_parts[0] ?? 0);
        $cur_minor = (int)($cur_parts[1] ?? 0); $new_minor = (int)($new_parts[1] ?? 0);
        if ($cur_major < $new_major)      $sev = 'error';
        elseif ($cur_minor < $new_minor)  $sev = 'warning';
        else                              $sev = 'info';
        mithras_soc_finding(
            'core.outdated',
            'core', $sev,
            "WordPress core out of date ($wp_version → $latest)",
            "The installed WordPress version is behind the current release.",
            "Update WordPress core via Dashboard → Updates, or enable auto-update of minor versions.",
            ['installed' => $wp_version, 'latest' => $latest]
        );
    }
}

function mithras_soc_audit_plugin_updates(): void {
    if (!function_exists('get_plugins')) require_once ABSPATH . 'wp-admin/includes/plugin.php';
    wp_update_plugins();
    $updates = get_site_transient('update_plugins');
    if (!$updates || empty($updates->response)) return;
    foreach ($updates->response as $file => $info) {
        $name = $file;
        $plugins = get_plugins();
        if (isset($plugins[$file]['Name'])) $name = $plugins[$file]['Name'];
        $cur = $plugins[$file]['Version'] ?? '?';
        $new = $info->new_version ?? '?';
        mithras_soc_finding(
            'plugin.outdated:' . $file,
            'plugin', 'warning',
            "Plugin out of date: $name ($cur → $new)",
            "A newer version of this plugin is available.",
            "Update the plugin via Dashboard → Plugins.",
            ['file' => $file, 'installed' => $cur, 'latest' => $new]
        );
    }
}

function mithras_soc_audit_theme_updates(): void {
    wp_update_themes();
    $updates = get_site_transient('update_themes');
    if (!$updates || empty($updates->response)) return;
    foreach ($updates->response as $slug => $info) {
        $theme = wp_get_theme($slug);
        $cur = $theme->get('Version');
        $new = $info['new_version'] ?? '?';
        mithras_soc_finding(
            'theme.outdated:' . $slug,
            'theme', 'warning',
            "Theme out of date: " . $theme->get('Name') . " ($cur → $new)",
            "A newer version of this theme is available.",
            "Update the theme via Dashboard → Appearance → Themes.",
            ['slug' => $slug, 'installed' => $cur, 'latest' => $new]
        );
    }
}

function mithras_soc_audit_default_admin_user(): void {
    $u = get_user_by('login', 'admin');
    if (!$u) return;
    $is_admin = in_array('administrator', (array) $u->roles, true);
    if ($is_admin) {
        mithras_soc_finding(
            'user.default_admin',
            'user', 'critical',
            "Default 'admin' username is an administrator",
            "The user 'admin' is the most commonly targeted account for brute-force attacks.",
            "Create a new administrator with a non-default username, then demote or delete the 'admin' user (preserving their content).",
            ['user_id' => $u->ID]
        );
    }
}

function mithras_soc_audit_admin_count(): void {
    $admins = get_users(['role' => 'administrator', 'fields' => ['ID', 'user_login']]);
    if (count($admins) > 5) {
        mithras_soc_finding(
            'user.too_many_admins',
            'user', 'warning',
            "Many administrator accounts (" . count($admins) . ")",
            "Sites typically need only 1-3 administrators. Excess admin accounts increase the attack surface.",
            "Review the administrator list and demote any account that doesn't need full admin rights.",
            ['count' => count($admins), 'logins' => array_column($admins, 'user_login')]
        );
    }
}

function mithras_soc_audit_users_can_register(): void {
    if ((bool) get_option('users_can_register')) {
        $default = get_option('default_role');
        $sev = $default === 'administrator' || $default === 'editor' ? 'critical' : 'warning';
        mithras_soc_finding(
            'config.users_can_register',
            'config', $sev,
            "Anyone-can-register is enabled (default role: $default)",
            "Public registration plus an elevated default role lets attackers create accounts with privileges.",
            "Disable Settings → General → Anyone can register, or change the default role to 'subscriber'.",
            ['default_role' => $default]
        );
    }
}

function mithras_soc_audit_wp_debug(): void {
    if (defined('WP_DEBUG') && WP_DEBUG === true) {
        mithras_soc_finding(
            'config.wp_debug',
            'config', 'warning',
            "WP_DEBUG is enabled in production",
            "Debug mode can expose sensitive paths, queries, and stack traces.",
            "Set define('WP_DEBUG', false) in wp-config.php for production sites."
        );
    }
}

function mithras_soc_audit_file_edit(): void {
    if (!defined('DISALLOW_FILE_EDIT') || DISALLOW_FILE_EDIT !== true) {
        mithras_soc_finding(
            'config.file_edit_allowed',
            'config', 'error',
            "In-dashboard file editing is enabled",
            "Without DISALLOW_FILE_EDIT, an attacker who pops an admin account can paste a webshell into a theme or plugin file and gain code execution.",
            "Add define('DISALLOW_FILE_EDIT', true); to wp-config.php."
        );
    }
}

function mithras_soc_audit_ssl_admin(): void {
    if (!is_ssl()) return;          // Site doesn't serve over HTTPS yet — separate finding
    if (!defined('FORCE_SSL_ADMIN') || FORCE_SSL_ADMIN !== true) {
        mithras_soc_finding(
            'config.force_ssl_admin',
            'config', 'warning',
            "FORCE_SSL_ADMIN is not enabled",
            "Admin and login forms can still be served over HTTP, exposing credentials to network observers.",
            "Add define('FORCE_SSL_ADMIN', true); to wp-config.php."
        );
    }
}

function mithras_soc_audit_xmlrpc(): void {
    // If our protection toggle is disabled, surface the platform-side risk.
    $s = get_option('mithras_soc_protection', []);
    if (!empty($s['disable_xmlrpc'])) return;
    if (apply_filters('xmlrpc_enabled', true)) {
        mithras_soc_finding(
            'config.xmlrpc_enabled',
            'config', 'warning',
            "XML-RPC is enabled",
            "XML-RPC is a common brute-force amplification + pingback DDoS reflector.",
            "Disable XML-RPC unless you specifically use the WP mobile app, Jetpack, or a remote publisher. Mithras can block it for you."
        );
    }
}

function mithras_soc_audit_php_version(): void {
    $php = PHP_VERSION;
    // Hard-coded EOL table — updated when the plugin updates.
    $eol = [
        '7.4' => '2022-11-28',
        '8.0' => '2023-11-26',
        '8.1' => '2025-12-31',
        '8.2' => '2026-12-31',
        '8.3' => '2027-12-31',
        '8.4' => '2028-12-31',
    ];
    $branch = implode('.', array_slice(explode('.', $php), 0, 2));
    if (!isset($eol[$branch])) return;
    $eol_date = strtotime($eol[$branch]);
    if (time() > $eol_date) {
        $years = floor((time() - $eol_date) / (365 * 86400));
        $sev = $years >= 1 ? 'critical' : 'error';
        mithras_soc_finding(
            'server.php_eol',
            'server', $sev,
            "PHP $php is end-of-life",
            "This PHP version no longer receives security patches. Hosting providers can usually upgrade you with one click.",
            "Ask your host to upgrade PHP to 8.3 or 8.4.",
            ['installed' => $php, 'eol_date' => $eol[$branch]]
        );
    }
}

function mithras_soc_audit_uploads_php_files(): void {
    $s = get_option('mithras_soc_protection', []);
    if (empty($s['scan_uploads_for_php'])) return;
    $upload = wp_upload_dir();
    $base = $upload['basedir'] ?? null;
    if (!$base || !is_dir($base)) return;

    // Recursive scan with a hard cap to avoid runaway on huge media libraries.
    $count = 0; $max = 50; $found = [];
    try {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base, RecursiveDirectoryIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($count >= 5000) break;
            $count++;
            $name = $f->getFilename();
            if (preg_match('/\.(ph[ps]?|phtml|phar|pht)$/i', $name) ||
                preg_match('/\.\w+\.php$/i', $name)) {  // double-extension trick
                $found[] = str_replace($base, '', $f->getPathname());
                if (count($found) >= $max) break;
            }
        }
    } catch (Throwable $e) { return; }

    if (!empty($found)) {
        mithras_soc_finding(
            'file_integrity.php_in_uploads',
            'file_integrity', 'critical',
            count($found) . " PHP file(s) inside wp-content/uploads/",
            "Uploads directories should never contain executable code. Files here are commonly malicious uploads dropped by exploit kits.",
            "Inspect each file. Delete if not legitimate. Add a server rule blocking PHP execution in /uploads/.",
            ['files' => array_slice($found, 0, 50)]
        );
    }
}

function mithras_soc_audit_security_headers(): void {
    // Don't make a loopback HTTP request to home_url() — on small / single-
    // worker hosts that deadlocks the PHP-FPM pool and hangs cron. Instead
    // infer header coverage from the plugin's own send_headers hook plus the
    // protection settings the platform pushed down.
    $prot = get_option('mithras_soc_protection', []);
    $protection_on = !empty($prot['security_headers']);
    if ($protection_on && is_ssl()) {
        return;     // Plugin will add HSTS, XFO, XCTO, Referrer-Policy on every response.
    }
    $missing = [];
    if (!$protection_on) {
        $missing = ['HSTS', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy'];
    } elseif (!is_ssl()) {
        $missing = ['HSTS (site not on HTTPS)'];
    }
    if (!empty($missing)) {
        mithras_soc_finding(
            'headers.missing',
            'headers', 'warning',
            "Missing security headers: " . implode(', ', $missing),
            "These headers protect users from clickjacking, MIME confusion, and referrer leaks.",
            "Mithras can add these for you — enable the Security Headers protection toggle in the Mithras dashboard.",
            ['missing' => $missing]
        );
    }
}

// ---------------------------------------------------------------------------
// Audit orchestrator
// ---------------------------------------------------------------------------
function mithras_soc_run_audit(): void {
    global $mithras_soc_finding_queue, $mithras_soc_audit_keys_current;
    $mithras_soc_finding_queue      = [];
    $mithras_soc_audit_keys_current = [];

    if (function_exists('mithras_soc_queue_event')) {
        mithras_soc_queue_event('audit_started', 'Mithras audit started', ['target' => 'audit'], 'info');
    }

    mithras_soc_audit_core_version();
    mithras_soc_audit_plugin_updates();
    mithras_soc_audit_theme_updates();
    mithras_soc_audit_default_admin_user();
    mithras_soc_audit_admin_count();
    mithras_soc_audit_users_can_register();
    mithras_soc_audit_wp_debug();
    mithras_soc_audit_file_edit();
    mithras_soc_audit_ssl_admin();
    mithras_soc_audit_xmlrpc();
    mithras_soc_audit_php_version();
    mithras_soc_audit_uploads_php_files();
    mithras_soc_audit_security_headers();

    // Push findings on the next heartbeat by stashing them in an option.
    // The "ready" flag is consumed once on the next successful flush; it
    // prevents periodic retry flushes from accidentally signalling
    // audit_completed=true with a stale (or empty) key list.
    update_option('mithras_soc_pending_findings', $mithras_soc_finding_queue, false);
    update_option('mithras_soc_pending_audit_keys', $mithras_soc_audit_keys_current, false);
    update_option('mithras_soc_audit_ready', 1, false);
    update_option('mithras_soc_last_audit_at', gmdate('c'), false);

    if (function_exists('mithras_soc_queue_event')) {
        mithras_soc_queue_event('audit_completed', 'Mithras audit completed (' . count($mithras_soc_finding_queue) . ' findings)', ['target' => 'audit'], 'info');
    }

    // Force-flush immediately so the SOC sees results without waiting.
    if (function_exists('mithras_soc_flush')) {
        mithras_soc_flush();
    }
}

// Hook the daily cron.
add_action('mithras_soc_audit', 'mithras_soc_run_audit');
add_filter('cron_schedules', function ($s) {
    $s['mithras_daily'] = ['interval' => 86400, 'display' => 'Once daily (Mithras)'];
    return $s;
});
