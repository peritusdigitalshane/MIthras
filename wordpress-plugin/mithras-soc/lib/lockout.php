<?php
/**
 * Login lockout. Tracks failed login attempts per IP in WP transients with TTL
 * matching the configured lockout window. On the (N+1)-th failure the IP is
 * locked and authenticate calls bypass straight to a WP_Error. A
 * lockout_triggered SIEM event is queued so the SOC sees the lockout in real
 * time.
 */

if (!defined('ABSPATH')) { exit; }

function mithras_soc_lockout_settings(): array {
    $s = get_option('mithras_soc_protection', []);
    return is_array($s) ? $s : [];
}

function mithras_soc_lockout_ip_key(string $ip): string {
    return 'mithras_lockout_' . md5($ip);
}

function mithras_soc_is_ip_locked(string $ip): bool {
    return (bool) get_transient(mithras_soc_lockout_ip_key($ip) . '_locked');
}

function mithras_soc_lockout_record_failure(string $ip, string $login): void {
    $s = mithras_soc_lockout_settings();
    if (empty($s['limit_login_attempts'])) return;

    $threshold = max(2, (int)($s['login_lockout_threshold'] ?? 5));
    $minutes   = max(1, (int)($s['login_lockout_minutes']   ?? 30));

    $ckey = mithras_soc_lockout_ip_key($ip) . '_count';
    $count = (int) get_transient($ckey);
    $count++;
    set_transient($ckey, $count, $minutes * 60);

    if ($count >= $threshold) {
        set_transient(mithras_soc_lockout_ip_key($ip) . '_locked', 1, $minutes * 60);
        if (function_exists('mithras_soc_queue_event')) {
            mithras_soc_queue_event(
                'lockout_triggered',
                "IP $ip locked for $minutes min after $count failed logins (last: $login)",
                ['target' => 'ip:' . $ip, 'raw' => ['threshold' => $threshold, 'minutes' => $minutes, 'count' => $count]],
                'critical'
            );
        }
    }
}

add_filter('authenticate', function ($user, $username, $password) {
    $s = mithras_soc_lockout_settings();
    if (empty($s['limit_login_attempts'])) return $user;
    if (empty($username) && empty($password)) return $user;

    $ip = function_exists('mithras_soc_client_ip') ? mithras_soc_client_ip() : ($_SERVER['REMOTE_ADDR'] ?? null);
    if (!$ip) return $user;

    if (mithras_soc_is_ip_locked($ip)) {
        $minutes = max(1, (int)($s['login_lockout_minutes'] ?? 30));
        return new WP_Error(
            'mithras_locked',
            sprintf('<strong>Locked.</strong> Too many failed attempts. Try again in up to %d minutes.', $minutes)
        );
    }
    return $user;
}, 30, 3);

add_action('wp_login_failed', function ($username) {
    $ip = function_exists('mithras_soc_client_ip') ? mithras_soc_client_ip() : ($_SERVER['REMOTE_ADDR'] ?? null);
    if ($ip) mithras_soc_lockout_record_failure($ip, (string)$username);
});
