output "server_ipv4" {
  value = digitalocean_droplet.app.ipv4_address
}

output "server_ipv6" {
  value = digitalocean_droplet.app.ipv6_address
}

output "ssh_target" {
  value = "${var.deploy_user}@${digitalocean_droplet.app.ipv4_address}"
}

output "ssh_known_hosts" {
  value = "${digitalocean_droplet.app.ipv4_address} ${trimspace(tls_private_key.host.public_key_openssh)}"
}

output "database_url" {
  value     = local.database_url
  sensitive = true
}

output "api_env_file" {
  value     = join("", [for k in sort(keys(local.api_env)) : "${k}='${local.api_env[k]}'\n"])
  sensitive = true
  precondition {
    condition     = alltrue([for v in values(local.api_env) : !strcontains(v, "'") && !strcontains(v, "\n") && !strcontains(v, "\r")])
    error_message = "API environment values cannot contain single quotes or line breaks."
  }
}

output "postgres_env_file" {
  value     = "POSTGRES_DB='quotedb'\nPOSTGRES_USER='quotedb'\nPOSTGRES_PASSWORD='${random_password.postgres.result}'\n"
  sensitive = true
}
