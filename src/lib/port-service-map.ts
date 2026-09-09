/**
 * Well-known port → service mapping with descriptions and risk levels.
 * Used by the Audit Findings panel to auto-label observed traffic.
 */

export interface PortServiceInfo {
  name: string;
  description: string;
  risk: "low" | "medium" | "high" | "critical";
}

const portServiceMap: Record<number, PortServiceInfo> = {
  20:    { name: "FTP Data",         description: "File Transfer Protocol data channel",            risk: "high" },
  21:    { name: "FTP Control",      description: "File Transfer Protocol control channel",          risk: "high" },
  22:    { name: "SSH",              description: "Secure Shell remote access",                      risk: "medium" },
  23:    { name: "Telnet",           description: "Unencrypted remote terminal (insecure)",           risk: "critical" },
  25:    { name: "SMTP",             description: "Simple Mail Transfer Protocol – email relay",      risk: "medium" },
  53:    { name: "DNS",              description: "Domain Name System lookups",                       risk: "low" },
  67:    { name: "DHCP Server",      description: "Dynamic Host Configuration Protocol (server)",     risk: "low" },
  68:    { name: "DHCP Client",      description: "Dynamic Host Configuration Protocol (client)",     risk: "low" },
  80:    { name: "HTTP",             description: "Unencrypted web traffic",                          risk: "medium" },
  88:    { name: "Kerberos",         description: "Active Directory authentication",                  risk: "low" },
  110:   { name: "POP3",             description: "Post Office Protocol – email retrieval",           risk: "high" },
  123:   { name: "NTP",              description: "Network Time Protocol – clock sync",               risk: "low" },
  135:   { name: "RPC/EPMAP",        description: "Windows RPC Endpoint Mapper",                      risk: "high" },
  137:   { name: "NetBIOS Name",     description: "NetBIOS name resolution",                          risk: "high" },
  138:   { name: "NetBIOS Datagram", description: "NetBIOS datagram service",                         risk: "high" },
  139:   { name: "NetBIOS Session",  description: "NetBIOS session / legacy SMB",                     risk: "high" },
  143:   { name: "IMAP",             description: "Internet Message Access Protocol – email",          risk: "medium" },
  161:   { name: "SNMP",             description: "Simple Network Management Protocol",                risk: "high" },
  162:   { name: "SNMP Trap",        description: "SNMP trap notifications",                           risk: "high" },
  389:   { name: "LDAP",             description: "Lightweight Directory Access Protocol",              risk: "medium" },
  443:   { name: "HTTPS",            description: "Encrypted web traffic (TLS)",                       risk: "low" },
  445:   { name: "SMB",              description: "Server Message Block – Windows file sharing",       risk: "high" },
  465:   { name: "SMTPS",            description: "SMTP over TLS – secure email relay",                risk: "low" },
  514:   { name: "Syslog",           description: "System log forwarding",                             risk: "medium" },
  587:   { name: "SMTP Submission",  description: "Email submission (authenticated)",                  risk: "low" },
  636:   { name: "LDAPS",            description: "LDAP over TLS – secure directory access",           risk: "low" },
  993:   { name: "IMAPS",            description: "IMAP over TLS – secure email retrieval",            risk: "low" },
  995:   { name: "POP3S",            description: "POP3 over TLS – secure email retrieval",            risk: "low" },
  1433:  { name: "MS SQL",           description: "Microsoft SQL Server database",                     risk: "high" },
  1434:  { name: "MS SQL Browser",   description: "SQL Server Browser Service",                        risk: "high" },
  1521:  { name: "Oracle DB",        description: "Oracle Database listener",                          risk: "high" },
  1723:  { name: "PPTP VPN",         description: "Point-to-Point Tunneling Protocol (insecure VPN)",  risk: "critical" },
  2049:  { name: "NFS",              description: "Network File System",                               risk: "high" },
  3306:  { name: "MySQL",            description: "MySQL / MariaDB database",                          risk: "high" },
  3389:  { name: "RDP",              description: "Remote Desktop Protocol – remote access",           risk: "critical" },
  5060:  { name: "SIP",              description: "Session Initiation Protocol – VoIP signaling",      risk: "medium" },
  5432:  { name: "PostgreSQL",       description: "PostgreSQL database",                               risk: "high" },
  5672:  { name: "AMQP",             description: "Advanced Message Queuing Protocol (RabbitMQ)",      risk: "medium" },
  5900:  { name: "VNC",              description: "Virtual Network Computing – remote desktop",        risk: "critical" },
  5985:  { name: "WinRM HTTP",       description: "Windows Remote Management (HTTP)",                  risk: "high" },
  5986:  { name: "WinRM HTTPS",      description: "Windows Remote Management (HTTPS)",                 risk: "medium" },
  6379:  { name: "Redis",            description: "Redis in-memory data store",                        risk: "high" },
  8080:  { name: "HTTP Proxy",       description: "HTTP proxy or alternate web server",                risk: "medium" },
  8443:  { name: "HTTPS Alt",        description: "Alternate HTTPS port",                              risk: "low" },
  9200:  { name: "Elasticsearch",    description: "Elasticsearch REST API",                            risk: "high" },
  27017: { name: "MongoDB",          description: "MongoDB NoSQL database",                            risk: "high" },
};

/**
 * Look up a well-known port. Returns undefined for unknown ports.
 */
export function getPortServiceInfo(port: number): PortServiceInfo | undefined {
  return portServiceMap[port];
}

/**
 * Get a display label for a port – uses the map if known, falls back to the
 * agent-reported service_name, or "Unknown".
 */
export function getServiceLabel(port: number, agentServiceName?: string): string {
  const info = portServiceMap[port];
  if (info) return info.name;
  if (agentServiceName && agentServiceName !== "Unknown") return agentServiceName;
  return `Port ${port}`;
}
