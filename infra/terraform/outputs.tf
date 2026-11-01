output "urls" {
  value = { for name, host in local.hosts : name => "https://${host}" }
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
