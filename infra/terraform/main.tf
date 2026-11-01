locals {
  hosts = {
    site  = var.domain
    web   = "app.${var.domain}"
    admin = "admin.${var.domain}"
    api   = "api.${var.domain}"
  }
}

resource "random_password" "cookie_secret" {
  length  = 64
  special = false
}

# The only platform-specific backend code. Swap the source for ./modules/<platform>-backend to move.
module "backend" {
  source = "./modules/digitalocean-backend"

  project_name    = "quotedb"
  region          = var.digitalocean_region
  ssh_public_keys = var.ssh_public_keys
  server_size     = var.droplet_size
  backups         = var.droplet_backups

  api_env = merge(
    {
      NODE_ENV       = "production"
      LOG_LEVEL      = var.log_level
      TRUST_PROXY    = "true"
      APP_URL        = "https://${local.hosts.api}"
      WEB_URL        = "https://${local.hosts.web}"
      ADMIN_URL      = "https://${local.hosts.admin}"
      COOKIE_DOMAIN  = ".${var.domain}"
      COOKIE_SECRET  = random_password.cookie_secret.result
      MAIL_FROM      = "QuoteDB <no-reply@${var.domain}>"
      RESEND_API_KEY = var.resend_api_key
      HIBP_ENABLED   = tostring(var.hibp_enabled)
    },
    var.izaro_user_id == "" ? {} : { IZARO_USER_ID = var.izaro_user_id },
    var.izaro_collection_id == "" ? {} : { IZARO_COLLECTION_ID = var.izaro_collection_id },
  )
}

# All four hosts terminate TLS on Caddy. DNS-only also supports nested subdomains
# without depending on Cloudflare Universal SSL coverage.
resource "cloudflare_dns_record" "app" {
  for_each = local.hosts

  zone_id = var.cloudflare_zone_id
  type    = "A"
  name    = each.value
  content = module.backend.server_ipv4
  ttl     = 300
  proxied = false
  comment = "quotedb ${each.key} (managed by OpenTofu)"
}

resource "cloudflare_dns_record" "app_ipv6" {
  for_each = local.hosts

  zone_id = var.cloudflare_zone_id
  type    = "AAAA"
  name    = each.value
  content = module.backend.server_ipv6
  ttl     = 300
  proxied = false
  comment = "quotedb ${each.key} (managed by OpenTofu)"
}

resource "cloudflare_dns_record" "extra" {
  for_each = var.extra_dns_records

  zone_id  = var.cloudflare_zone_id
  type     = each.value.type
  name     = each.value.name
  content  = each.value.content
  priority = each.value.priority
  ttl      = 1
  proxied  = false
  comment  = "quotedb ${each.key} (managed by OpenTofu)"
}
