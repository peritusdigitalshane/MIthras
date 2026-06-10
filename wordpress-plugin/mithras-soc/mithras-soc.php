<?php
/**
 * Plugin Name: Mithras Threat Defence
 * Plugin URI:  https://www.mithras.com.au
 * Description: SIEM logging, daily security audit, and active protection for WordPress sites — operated from the Mithras SOC platform.
 * Version:     0.2.3
 * Author:      Mithras
 * License:     GPL-2.0+
 * Text Domain: mithras-soc
 *
 * This plugin sends only metadata about events that happen on the site. It
 * does NOT send post content bodies, passwords, or session tokens.
 */

if (!defined('ABSPATH')) { exit; }

define('MITHRAS_SOC_VERSION', '0.2.3');
define('MITHRAS_SOC_DEFAULT_API', 'https://api.mithras.com.au');
define('MITHRAS_SOC_QUEUE_OPT',  'mithras_soc_event_queue');
define('MITHRAS_SOC_MAX_QUEUE',  500);

// Load audit + protect + lockout modules.
require_once __DIR__ . '/lib/protect.php';
require_once __DIR__ . '/lib/lockout.php';
require_once __DIR__ . '/lib/audit.php';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function mithras_soc_settings(): array {
    return [
        'api_base'   => get_option('mithras_soc_api_base', MITHRAS_SOC_DEFAULT_API),
        'site_id'    => get_option('mithras_soc_site_id', ''),
        'site_secret'=> get_option('mithras_soc_site_secret', ''),
    ];
}

function mithras_soc_is_enrolled(): bool {
    $s = mithras_soc_settings();
    return !empty($s['site_id']) && !empty($s['site_secret']);
}

function mithras_soc_client_ip(): ?string {
    foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'] as $key) {
        if (!empty($_SERVER[$key])) {
            $candidate = trim(explode(',', $_SERVER[$key])[0]);
            if (filter_var($candidate, FILTER_VALIDATE_IP)) return $candidate;
        }
    }
    return null;
}

function mithras_soc_queue_event(string $type, string $summary, array $extra = [], string $severity = 'info'): void {
    if (!mithras_soc_is_enrolled()) return;
    $queue = get_option(MITHRAS_SOC_QUEUE_OPT, []);
    if (!is_array($queue)) $queue = [];
    if (count($queue) >= MITHRAS_SOC_MAX_QUEUE) array_shift($queue);

    $current = wp_get_current_user();
    $queue[] = [
        'event_type'       => $type,
        'severity'         => $severity,
        'actor_user_login' => $current && $current->ID ? $current->user_login : null,
        'actor_ip'         => mithras_soc_client_ip(),
        'target'           => $extra['target']  ?? null,
        'summary'          => mb_substr($summary, 0, 1900),
        'event_time'       => gmdate('c'),
        'raw'              => $extra['raw'] ?? null,
    ];
    update_option(MITHRAS_SOC_QUEUE_OPT, $queue, false);

    // Fire-and-forget realtime flush for high-severity events. Low-severity
    // events wait for the 5-minute cron flush.
    if ($severity === 'critical' || $severity === 'error' || $type === 'login_failed') {
        wp_schedule_single_event(time() + 1, 'mithras_soc_flush_now');
    }
}

// -------------------------------------------------------------------
// Heartbeat + flush
// -------------------------------------------------------------------
function mithras_soc_collect_site_posture(): array {
    global $wp_version;
    $active_plugins = (array) get_option('active_plugins', []);
    $active_theme   = wp_get_theme();
    return [
        'wp_version'   => $wp_version,
        'php_version'  => PHP_VERSION,
        'plugin_count' => count($active_plugins),
        'active_theme' => $active_theme ? $active_theme->get('Name') : null,
    ];
}

function mithras_soc_flush(): array {
    if (!mithras_soc_is_enrolled()) return ['error' => 'not_enrolled'];
    $s = mithras_soc_settings();
    $queue = get_option(MITHRAS_SOC_QUEUE_OPT, []);
    if (!is_array($queue)) $queue = [];
    $findings = get_option('mithras_soc_pending_findings', []);
    $audit_keys = get_option('mithras_soc_pending_audit_keys', []);
    // Only treat this flush as completing an audit run when the audit
    // module set the explicit "ready" flag. Periodic flushes that find
    // stale options from a previous failed send must NOT signal
    // audit_completed — otherwise the server auto-resolves findings that
    // are still genuinely active.
    $audit_ready = (bool) get_option('mithras_soc_audit_ready', 0);
    $audit_complete = $audit_ready && is_array($audit_keys) && !empty($audit_keys);

    $body = mithras_soc_collect_site_posture();
    $body['events']   = $queue;
    $body['findings'] = is_array($findings) ? $findings : [];
    if ($audit_complete) {
        $body['audit_completed']     = true;
        $body['audit_keys_current']  = $audit_keys;
    }

    $resp = wp_remote_post(rtrim($s['api_base'], '/') . '/functions/v1/site-heartbeat', [
        'timeout'   => 15,
        'blocking'  => true,
        'redirection' => 2,
        'headers'   => [
            'Content-Type'   => 'application/json',
            'x-site-id'      => $s['site_id'],
            'x-site-secret'  => $s['site_secret'],
            'User-Agent'     => 'mithras-soc/' . MITHRAS_SOC_VERSION,
        ],
        'body'      => wp_json_encode($body),
    ]);

    if (is_wp_error($resp)) {
        return ['error' => $resp->get_error_message()];
    }
    $code = wp_remote_retrieve_response_code($resp);
    if ($code >= 200 && $code < 300) {
        update_option(MITHRAS_SOC_QUEUE_OPT, [], false);
        if ($audit_complete) {
            update_option('mithras_soc_pending_findings', [], false);
            update_option('mithras_soc_pending_audit_keys', [], false);
            update_option('mithras_soc_audit_ready', 0, false);
        }
        $resp_body = json_decode(wp_remote_retrieve_body($resp), true);
        if (is_array($resp_body) && !empty($resp_body['protection']) && isset($resp_body['protection']['settings'])) {
            update_option('mithras_soc_protection',          $resp_body['protection']['settings'], false);
            update_option('mithras_soc_protection_version',  (int)($resp_body['protection']['version'] ?? 1), false);
        }
        return ['ok' => true, 'sent' => count($queue), 'findings_sent' => count($findings)];
    }
    return ['error' => 'http_' . $code, 'body' => wp_remote_retrieve_body($resp)];
}

add_action('mithras_soc_flush_now', 'mithras_soc_flush');
add_action('mithras_soc_cron_flush', 'mithras_soc_flush');

// 5-minute cron schedule.
add_filter('cron_schedules', function ($schedules) {
    $schedules['mithras_5min'] = ['interval' => 300, 'display' => 'Every 5 minutes (Mithras)'];
    return $schedules;
});
register_activation_hook(__FILE__, function () {
    if (!wp_next_scheduled('mithras_soc_cron_flush')) {
        wp_schedule_event(time() + 60, 'mithras_5min', 'mithras_soc_cron_flush');
    }
    if (!wp_next_scheduled('mithras_soc_audit')) {
        wp_schedule_event(time() + 600, 'mithras_daily', 'mithras_soc_audit');
    }
});
register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('mithras_soc_cron_flush');
    wp_clear_scheduled_hook('mithras_soc_audit');
});

// -------------------------------------------------------------------
// Event hooks — translate WP actions into SIEM events
// -------------------------------------------------------------------

// Auth
add_action('wp_login', function ($user_login, $user) {
    mithras_soc_queue_event('login_success', "Login: $user_login", [
        'target' => 'user:' . $user_login,
    ], 'info');
}, 10, 2);

add_action('wp_login_failed', function ($user_login) {
    mithras_soc_queue_event('login_failed', "Failed login attempt for $user_login", [
        'target' => 'user:' . $user_login,
    ], 'warning');
}, 10, 1);

// User lifecycle
add_action('user_register', function ($user_id) {
    $u = get_userdata($user_id);
    mithras_soc_queue_event('user_created', "New user registered: {$u->user_login}", [
        'target' => 'user:' . $u->user_login,
        'raw'    => ['user_id' => $user_id, 'email' => $u->user_email, 'roles' => $u->roles],
    ], 'info');
}, 10, 1);

add_action('profile_update', function ($user_id, $old_user_data) {
    $u = get_userdata($user_id);
    mithras_soc_queue_event('user_updated', "User profile updated: {$u->user_login}", [
        'target' => 'user:' . $u->user_login,
    ], 'info');
}, 10, 2);

add_action('deleted_user', function ($user_id) {
    mithras_soc_queue_event('user_deleted', "User deleted (id=$user_id)", [
        'target' => 'user:' . $user_id,
    ], 'warning');
}, 10, 1);

add_action('set_user_role', function ($user_id, $new_role, $old_roles) {
    $u = get_userdata($user_id);
    $old = implode(',', $old_roles);
    mithras_soc_queue_event('role_changed', "Role changed for {$u->user_login}: $old -> $new_role", [
        'target' => 'user:' . $u->user_login,
        'raw'    => ['old' => $old_roles, 'new' => $new_role],
    ], $new_role === 'administrator' ? 'critical' : 'warning');
}, 10, 3);

// Plugins
add_action('activated_plugin', function ($plugin, $network) {
    mithras_soc_queue_event('plugin_activated', "Plugin activated: $plugin", [
        'target' => 'plugin:' . $plugin,
    ], 'warning');
}, 10, 2);

add_action('deactivated_plugin', function ($plugin, $network) {
    mithras_soc_queue_event('plugin_deactivated', "Plugin deactivated: $plugin", [
        'target' => 'plugin:' . $plugin,
    ], 'warning');
}, 10, 2);

add_action('upgrader_process_complete', function ($upgrader, $hook_extra) {
    $type   = $hook_extra['type']   ?? 'unknown';
    $action = $hook_extra['action'] ?? 'unknown';
    $items  = $hook_extra['plugins'] ?? $hook_extra['themes'] ?? [];
    foreach ((array)$items as $item) {
        if ($type === 'plugin') mithras_soc_queue_event('plugin_updated', "Plugin $action: $item", ['target' => 'plugin:' . $item], 'warning');
        if ($type === 'theme')  mithras_soc_queue_event('theme_updated',  "Theme $action: $item",  ['target' => 'theme:' . $item],  'info');
        if ($type === 'core')   mithras_soc_queue_event('core_updated',   "WordPress core $action", ['target' => 'core'], 'warning');
    }
}, 10, 2);

// Themes
add_action('switch_theme', function ($new_name, $new_theme) {
    mithras_soc_queue_event('theme_switched', "Theme switched to: $new_name", [
        'target' => 'theme:' . $new_name,
    ], 'warning');
}, 10, 2);

// Posts
add_action('transition_post_status', function ($new, $old, $post) {
    if ($new === $old) return;
    if (in_array($post->post_type, ['revision','nav_menu_item','customize_changeset'])) return;
    mithras_soc_queue_event('post_status_changed',
        "Post '{$post->post_title}' [{$post->post_type}] {$old} -> {$new}",
        ['target' => 'post:' . $post->ID, 'raw' => ['old' => $old, 'new' => $new, 'post_type' => $post->post_type]],
        'info'
    );
}, 10, 3);

add_action('deleted_post', function ($post_id) {
    $p = get_post($post_id);
    if (!$p) return;
    if (in_array($p->post_type, ['revision','nav_menu_item','customize_changeset'])) return;
    mithras_soc_queue_event('post_deleted', "Post '{$p->post_title}' [{$p->post_type}] deleted", [
        'target' => 'post:' . $post_id,
    ], 'warning');
}, 10, 1);

// Options — only notify on a whitelist of security-relevant keys.
$mithras_watched_options = ['siteurl','home','admin_email','blogname','permalink_structure','default_role','users_can_register','active_plugins','template','stylesheet','WPLANG','blog_public'];
foreach ($mithras_watched_options as $opt) {
    add_action("update_option_$opt", function ($old, $new) use ($opt) {
        if ($old === $new) return;
        mithras_soc_queue_event('option_changed', "Option `$opt` changed", [
            'target' => 'option:' . $opt,
            'raw'    => is_scalar($new) && is_scalar($old) ? ['old' => $old, 'new' => $new] : null,
        ], 'warning');
    }, 10, 2);
}

// -------------------------------------------------------------------
// Settings page (Settings → Mithras SOC)
// -------------------------------------------------------------------
add_action('admin_menu', function () {
    add_options_page('Mithras SOC', 'Mithras SOC', 'manage_options', 'mithras-soc', 'mithras_soc_render_settings_page');
});

// Add a "Settings" link directly in the plugins-list row for instant access.
add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    $url = esc_url(admin_url('options-general.php?page=mithras-soc'));
    array_unshift($links, '<a href="' . $url . '" style="font-weight:bold;color:#00897B">Settings</a>');
    return $links;
});

// Admin notice if not yet enrolled — points the user to the settings page.
add_action('admin_notices', function () {
    if (!current_user_can('manage_options')) return;
    if (mithras_soc_is_enrolled()) return;
    $screen = function_exists('get_current_screen') ? get_current_screen() : null;
    if ($screen && $screen->id === 'settings_page_mithras-soc') return;
    $url = esc_url(admin_url('options-general.php?page=mithras-soc'));
    echo '<div class="notice notice-warning is-dismissible"><p>'
       . '<strong>Mithras SOC is installed but not yet connected.</strong> '
       . '<a href="' . $url . '">Open settings</a> and paste an enrolment token to start streaming security events to the Mithras dashboard.'
       . '</p></div>';
});

function mithras_soc_render_settings_page(): void {
    if (!current_user_can('manage_options')) return;

    if (isset($_POST['mithras_soc_action']) && check_admin_referer('mithras_soc_settings')) {
        $action = sanitize_text_field($_POST['mithras_soc_action']);

        if ($action === 'enrol') {
            $api    = esc_url_raw(trim($_POST['api_base'] ?? MITHRAS_SOC_DEFAULT_API));
            $token  = sanitize_text_field($_POST['enrollment_token'] ?? '');
            if (!$api || !$token) {
                echo '<div class="notice notice-error"><p>API URL and enrolment token are both required.</p></div>';
            } else {
                update_option('mithras_soc_api_base', $api);
                $resp = wp_remote_post(rtrim($api,'/') . '/functions/v1/site-enroll', [
                    'timeout'  => 15,
                    'headers'  => ['Content-Type' => 'application/json'],
                    'body'     => wp_json_encode([
                        'enrollment_token' => $token,
                        'site_url'         => home_url(),
                        'name'             => get_bloginfo('name'),
                        'wp_version'       => get_bloginfo('version'),
                        'php_version'      => PHP_VERSION,
                    ]),
                ]);
                if (is_wp_error($resp)) {
                    echo '<div class="notice notice-error"><p>Enrolment failed: ' . esc_html($resp->get_error_message()) . '</p></div>';
                } else {
                    $code = wp_remote_retrieve_response_code($resp);
                    $body = json_decode(wp_remote_retrieve_body($resp), true);
                    if ($code >= 200 && $code < 300 && !empty($body['site_id']) && !empty($body['site_secret'])) {
                        update_option('mithras_soc_site_id',     $body['site_id']);
                        update_option('mithras_soc_site_secret', $body['site_secret']);
                        echo '<div class="notice notice-success"><p>Successfully enrolled. SOC events are now being streamed.</p></div>';
                        mithras_soc_queue_event('heartbeat', 'Plugin enrolled and activated', ['target' => 'plugin:mithras-soc'], 'info');
                    } else {
                        echo '<div class="notice notice-error"><p>Enrolment rejected: ' . esc_html($body['error'] ?? ('HTTP ' . $code)) . '</p></div>';
                    }
                }
            }
        } elseif ($action === 'disconnect') {
            delete_option('mithras_soc_site_id');
            delete_option('mithras_soc_site_secret');
            delete_option(MITHRAS_SOC_QUEUE_OPT);
            // Critical: clear protection + pending audit state so a reconnect
            // to a different site/org does not enforce stale toggles.
            delete_option('mithras_soc_protection');
            delete_option('mithras_soc_protection_version');
            delete_option('mithras_soc_pending_findings');
            delete_option('mithras_soc_pending_audit_keys');
            delete_option('mithras_soc_audit_ready');
            echo '<div class="notice notice-success"><p>Disconnected. No further events will be sent.</p></div>';
        } elseif ($action === 'flush') {
            $r = mithras_soc_flush();
            if (!empty($r['ok'])) echo '<div class="notice notice-success"><p>Flushed ' . (int)$r['sent'] . ' queued events.</p></div>';
            else echo '<div class="notice notice-error"><p>Flush failed: ' . esc_html($r['error'] ?? 'unknown') . '</p></div>';
        } elseif ($action === 'audit') {
            mithras_soc_run_audit();
            $fc = count(get_option('mithras_soc_pending_findings', []));
            echo '<div class="notice notice-success"><p>Audit complete — ' . (int)$fc . ' findings pushed to the SOC.</p></div>';
        }
    }

    $s = mithras_soc_settings();
    $enrolled = mithras_soc_is_enrolled();
    $queue = get_option(MITHRAS_SOC_QUEUE_OPT, []);
    $queue_count = is_array($queue) ? count($queue) : 0;
    ?>
    <div class="wrap">
        <h1>Mithras SOC</h1>
        <p>Stream WordPress security events (logins, user changes, plugin/theme/post/option changes) to the Mithras Threat Defence SOC for SIEM logging.</p>

        <?php if ($enrolled): ?>
            <div class="card">
                <h2>Connected</h2>
                <table class="form-table">
                    <tr><th>API endpoint</th><td><code><?php echo esc_html($s['api_base']); ?></code></td></tr>
                    <tr><th>Site ID</th><td><code><?php echo esc_html($s['site_id']); ?></code></td></tr>
                    <tr><th>Site secret</th><td><code><?php echo esc_html(substr($s['site_secret'], 0, 6) . '…(hidden)'); ?></code></td></tr>
                    <tr><th>Queued events</th><td><?php echo (int)$queue_count; ?></td></tr>
                </table>
                <form method="post" style="display:inline">
                    <?php wp_nonce_field('mithras_soc_settings'); ?>
                    <input type="hidden" name="mithras_soc_action" value="flush" />
                    <?php submit_button('Flush now', 'secondary', '', false); ?>
                </form>
                <form method="post" style="display:inline; margin-left:8px">
                    <?php wp_nonce_field('mithras_soc_settings'); ?>
                    <input type="hidden" name="mithras_soc_action" value="audit" />
                    <?php submit_button('Run audit now', 'secondary', '', false); ?>
                </form>
                <form method="post" style="display:inline; margin-left:8px">
                    <?php wp_nonce_field('mithras_soc_settings'); ?>
                    <input type="hidden" name="mithras_soc_action" value="disconnect" />
                    <?php submit_button('Disconnect', 'delete', '', false); ?>
                </form>
            </div>

            <?php
            $prot = get_option('mithras_soc_protection', []);
            $last_audit = get_option('mithras_soc_last_audit_at', '');
            ?>
            <div class="card">
                <h2>Protection (controlled from Mithras dashboard)</h2>
                <p>These toggles are pushed from the platform on every heartbeat. To change them, go to the Mithras dashboard → Sites → this site → Protection.</p>
                <p>Last audit: <code><?php echo esc_html($last_audit ?: 'never'); ?></code></p>
                <?php if (is_array($prot) && !empty($prot)): ?>
                <table class="form-table">
                    <?php foreach ($prot as $k => $v): ?>
                    <tr>
                        <th><?php echo esc_html($k); ?></th>
                        <td><code><?php echo is_bool($v) ? ($v ? 'on' : 'off') : esc_html((string)$v); ?></code></td>
                    </tr>
                    <?php endforeach; ?>
                </table>
                <?php else: ?>
                <p><em>No protection settings received yet — they will arrive on the next heartbeat.</em></p>
                <?php endif; ?>
            </div>
        <?php else: ?>
            <div class="card">
                <h2>Connect this site</h2>
                <p>Get an enrolment token from your Mithras dashboard at <em>Sites &rarr; Add site</em>.</p>
                <form method="post">
                    <?php wp_nonce_field('mithras_soc_settings'); ?>
                    <input type="hidden" name="mithras_soc_action" value="enrol" />
                    <table class="form-table">
                        <tr>
                            <th><label for="api_base">API endpoint</label></th>
                            <td><input id="api_base" type="url" name="api_base" value="<?php echo esc_attr($s['api_base']); ?>" class="regular-text" /></td>
                        </tr>
                        <tr>
                            <th><label for="enrollment_token">Enrolment token</label></th>
                            <td><input id="enrollment_token" type="text" name="enrollment_token" value="" class="regular-text" autocomplete="off" /></td>
                        </tr>
                    </table>
                    <?php submit_button('Connect to Mithras'); ?>
                </form>
            </div>
        <?php endif; ?>
    </div>
    <?php
}
