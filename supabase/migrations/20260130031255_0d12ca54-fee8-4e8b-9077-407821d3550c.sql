-- Clean up test data from firewall_audit_logs
DELETE FROM firewall_audit_logs 
WHERE remote_address IN ('192.168.1.100', '10.0.0.50', '172.16.0.25');