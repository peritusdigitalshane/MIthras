<?php
/**
 * Active protection layer. Pulls settings from WP option mithras_soc_protection
 * (updated by the heartbeat response) and applies enforcement on every page load.
 *
 * All toggles are off by default to honour user control; the platform default
 * for new sites is the MSP-grade baseline (see migration 20260530006000).
 */

if (!defined('ABSPATH')) { exit; }

function mithras_soc_protect_settings(): array {
    $s = get_option('mithras_soc_protection', null);
    return is_array($s) ? $s : [];
}

function mithras_soc_protect_enabled(string $key): bool {
    $s = mithras_soc_protect_settings();
    return !empty($s[$key]);
}

// ---------------------------------------------------------------------------
// 1. Disable in-dashboard file editor
// ---------------------------------------------------------------------------
// Hooks far too late to influence DISALLOW_FILE_EDIT — so we belt-and-braces
// by removing the menu entries even if the constant wasn't defined upstream.
add_action('admin_init', function () {
    if (!mithras_soc_protect_enabled('disable_file_edit')) return;
    if (!defined('DISALLOW_FILE_EDIT')) {
        // We can't define after WP loads — emit a finding so the MSP can edit wp-config.
        // The constant write is recommended path; this is the runtime fallback.
    }
    remove_submenu_page('themes.php',  'theme-editor.php');
    remove_submenu_page('plugins.php', 'plugin-editor.php');
});

// ---------------------------------------------------------------------------
// 2. Force SSL on admin / login
// ---------------------------------------------------------------------------
add_action('init', function () {
    if (!mithras_soc_protect_enabled('force_ssl_admin')) return;
    if (is_admin() && !is_ssl()) {
        // Use admin_url() so we never trust REQUEST_URI for the host portion.
        // wp_safe_redirect rejects external hosts, defending against a crafted
        // REQUEST_URI like "//evil.example/...".
        $path = ltrim(parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/', '/');
        $target = admin_url($path);
        wp_safe_redirect($target, 301);
        exit;
    }
});

// ---------------------------------------------------------------------------
// 3. Disable XML-RPC
// ---------------------------------------------------------------------------
add_filter('xmlrpc_enabled', function ($enabled) {
    return mithras_soc_protect_enabled('disable_xmlrpc') ? false : $enabled;
});
add_filter('wp_headers', function ($headers) {
    if (mithras_soc_protect_enabled('disable_xmlrpc')) {
        unset($headers['X-Pingback']);
    }
    return $headers;
});
add_filter('xmlrpc_methods', function ($methods) {
    if (!mithras_soc_protect_enabled('disable_xmlrpc')) return $methods;
    unset($methods['pingback.ping']);
    unset($methods['pingback.extensions.getPingbacks']);
    return $methods;
});

// ---------------------------------------------------------------------------
// 4. Hide WP version
// ---------------------------------------------------------------------------
add_action('init', function () {
    if (!mithras_soc_protect_enabled('hide_wp_version')) return;
    remove_action('wp_head', 'wp_generator');
    add_filter('the_generator', '__return_empty_string');
    add_filter('style_loader_src',  'mithras_soc_strip_version_query');
    add_filter('script_loader_src', 'mithras_soc_strip_version_query');
});
function mithras_soc_strip_version_query($src) {
    if (strpos((string)$src, 'ver=') !== false) {
        $src = remove_query_arg('ver', (string)$src);
    }
    return $src;
}

// ---------------------------------------------------------------------------
// 5. Block user enumeration (REST /wp/v2/users + ?author=N)
// ---------------------------------------------------------------------------
add_filter('rest_endpoints', function ($endpoints) {
    if (!mithras_soc_protect_enabled('block_user_enumeration')) return $endpoints;
    if (is_user_logged_in()) return $endpoints;
    if (isset($endpoints['/wp/v2/users']))           unset($endpoints['/wp/v2/users']);
    if (isset($endpoints['/wp/v2/users/(?P<id>[\\d]+)'])) unset($endpoints['/wp/v2/users/(?P<id>[\\d]+)']);
    return $endpoints;
});
add_action('template_redirect', function () {
    if (!mithras_soc_protect_enabled('block_user_enumeration')) return;
    if (is_user_logged_in()) return;
    if (!empty($_GET['author']) && preg_match('/^\d+$/', (string)$_GET['author'])) {
        wp_safe_redirect(home_url('/'), 301);
        exit;
    }
});

// ---------------------------------------------------------------------------
// 6. Security HTTP headers
// ---------------------------------------------------------------------------
add_action('send_headers', function () {
    if (!mithras_soc_protect_enabled('security_headers')) return;
    if (headers_sent()) return;
    header('X-Frame-Options: SAMEORIGIN');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: geolocation=(), camera=(), microphone=()');
    if (is_ssl()) {
        header('Strict-Transport-Security: max-age=15552000; includeSubDomains');
    }
});

// ---------------------------------------------------------------------------
// 7. Disable pingbacks
// ---------------------------------------------------------------------------
add_action('pre_ping', function (&$links) {
    if (mithras_soc_protect_enabled('disable_pingbacks')) {
        $links = [];
    }
});

// ---------------------------------------------------------------------------
// 8. Strong-password enforcement on user create / profile update
// ---------------------------------------------------------------------------
add_action('user_profile_update_errors', function ($errors, $update, $user) {
    if (!mithras_soc_protect_enabled('require_strong_passwords')) return;
    if (empty($_POST['pass1'])) return;
    $pw = (string) $_POST['pass1'];
    if (strlen($pw) < 12 ||
        !preg_match('/[A-Z]/', $pw) ||
        !preg_match('/[a-z]/', $pw) ||
        !preg_match('/[0-9]/', $pw) ||
        !preg_match('/[^A-Za-z0-9]/', $pw)) {
        $errors->add('weak_password', 'Password must be 12+ characters and include uppercase, lowercase, digit, and symbol.');
    }
}, 10, 3);

// ---------------------------------------------------------------------------
// 9. Disable application passwords (optional)
// ---------------------------------------------------------------------------
add_filter('wp_is_application_passwords_available', function ($available) {
    return mithras_soc_protect_enabled('disable_app_passwords') ? false : $available;
});

// ---------------------------------------------------------------------------
// 10. Block PHP execution in /wp-content/uploads/
// ---------------------------------------------------------------------------
// The only reliable way to stop PHP-FPM/mod_php from executing a .php file
// delivered straight out of uploads/ is at the web-server level — once Apache
// hands the request to PHP, WordPress is not loaded. So we:
//   (a) drop a defensive .htaccess into uploads/ that DENIES execution of
//       php/phtml/phar/pht (covers Apache + Litespeed).
//   (b) drop a web.config equivalent (covers IIS).
//   (c) keep an in-WP guard for completeness in case the file is served via
//       a WP-routed path (rare but possible with some rewrite configs).
//
// We never overwrite a pre-existing customer-managed file unless it contains
// our own header signature.
function mithras_soc_uploads_htaccess_body(): string {
    return "# Mithras — block PHP execution in uploads (managed file; do not edit)\n" .
           "<FilesMatch \"\\.(ph[ps]?|phtml|phar|pht)$\">\n" .
           "  # Apache 2.4+\n" .
           "  <IfModule mod_authz_core.c>\n" .
           "    Require all denied\n" .
           "  </IfModule>\n" .
           "  # Apache 2.2\n" .
           "  <IfModule !mod_authz_core.c>\n" .
           "    Order allow,deny\n" .
           "    Deny from all\n" .
           "  </IfModule>\n" .
           "</FilesMatch>\n";
}

function mithras_soc_uploads_webconfig_body(): string {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" .
           "<!-- Mithras — block PHP execution in uploads (managed file; do not edit) -->\n" .
           "<configuration>\n" .
           "  <system.webServer>\n" .
           "    <handlers>\n" .
           "      <clear />\n" .
           "      <add name=\"StaticFile\" path=\"*\" verb=\"*\" type=\"\" modules=\"StaticFileModule,DefaultDocumentModule,DirectoryListingModule\" resourceType=\"Either\" />\n" .
           "    </handlers>\n" .
           "  </system.webServer>\n" .
           "</configuration>\n";
}

function mithras_soc_ensure_uploads_php_block(): array {
    $upload = wp_upload_dir(null, false);
    $base = $upload['basedir'] ?? null;
    if (!$base) return ['status' => 'no_basedir'];
    if (!is_dir($base)) {
        @wp_mkdir_p($base);
    }
    if (!is_dir($base)) return ['status' => 'basedir_missing', 'path' => $base];

    $managed_header = 'Mithras — block PHP execution in uploads (managed file';
    $written = [];
    foreach ([
        '.htaccess'  => 'mithras_soc_uploads_htaccess_body',
        'web.config' => 'mithras_soc_uploads_webconfig_body',
    ] as $name => $fn) {
        $path = trailingslashit($base) . $name;
        if (file_exists($path)) {
            // Refresh if it's a previously-managed file; leave customer files alone.
            $existing = @file_get_contents($path);
            if ($existing === false || strpos($existing, $managed_header) === false) {
                continue;
            }
        }
        $ok = @file_put_contents($path, call_user_func($fn));
        $written[$name] = ($ok !== false) ? 'wrote' : 'write_failed';
    }
    return ['status' => 'ok', 'base' => $base, 'written' => $written];
}

// Always-on safety net: even outside admin, on every WP-loaded request, check
// the .htaccess exists. Cheap (single is_file call per request) and self-heals
// if the file is deleted.
add_action('init', function () {
    if (!mithras_soc_protect_enabled('block_php_in_uploads')) return;
    static $checked = false;
    if ($checked) return; $checked = true;
    $upload = wp_upload_dir(null, false);
    $base = $upload['basedir'] ?? null;
    if ($base && is_dir($base) && !is_file(trailingslashit($base) . '.htaccess')) {
        mithras_soc_ensure_uploads_php_block();
    }
});

// In-WP fallback (in case the file is served via a WP-routed path).
add_action('plugins_loaded', function () {
    if (!mithras_soc_protect_enabled('block_php_in_uploads')) return;
    $req_uri = (string) ($_SERVER['REQUEST_URI'] ?? '');
    if (stripos($req_uri, '/wp-content/uploads/') !== false &&
        preg_match('/\.(ph[ps]?|phtml|phar|pht)(\?|$)/i', $req_uri)) {
        status_header(403);
        nocache_headers();
        die('Forbidden');
    }
});

// On plugin activation and on every protection-settings update, drop the file.
register_activation_hook(dirname(__DIR__) . '/mithras-soc.php', 'mithras_soc_ensure_uploads_php_block');
add_action('update_option_mithras_soc_protection', function ($old, $new) {
    if (!empty($new['block_php_in_uploads'])) {
        mithras_soc_ensure_uploads_php_block();
    }
}, 10, 2);

// ---------------------------------------------------------------------------
// 11. Auto-update toggles
// ---------------------------------------------------------------------------
add_filter('auto_update_plugin', function ($update) {
    return mithras_soc_protect_enabled('auto_update_plugins') ? true : $update;
});
add_filter('auto_update_theme', function ($update) {
    return mithras_soc_protect_enabled('auto_update_themes') ? true : $update;
});
add_filter('allow_minor_auto_core_updates', function ($update) {
    return mithras_soc_protect_enabled('auto_update_minor_core') ? true : $update;
});
