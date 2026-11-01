output "urls" {
  value = merge({ for name, host in local.hosts : name => "https://${host}" }, { admin = "https://${var.admin_hostname}" })
}

output "server_ipv4" {
  value = module.backend.server_ipv4
}

output "api_ssh_target" {
  value = module.backend.ssh_target
}

output "api_ssh_known_hosts" {
  value = module.backend.ssh_known_hosts
}

output "api_env_file" {
  value     = module.backend.api_env_file
  sensitive = true
}

output "postgres_env_file" {
  value     = module.backend.postgres_env_file
  sensitive = true
}

output "database_url" {
  description = "Docker-network URL. Access the database through SSH, never a public port."
  value       = module.backend.database_url
  sensitive   = true
}

output "admin_origin_certificate" {
  value     = cloudflare_origin_ca_certificate.admin.certificate
  sensitive = true
}
output "admin_origin_private_key" {
  value     = tls_private_key.admin_origin.private_key_pem
  sensitive = true
}
