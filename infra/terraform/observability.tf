variable "status_monitoring_enabled" {
  description = "Provision the independent QuoteDB status store and health-only Access application."
  type        = bool
  default     = false
}
variable "status_domain_enabled" {
  description = "Bind the status custom domain after quotedb-status has been deployed."
  type        = bool
  default     = false
}
resource "cloudflare_d1_database" "status" {
  count      = var.status_monitoring_enabled ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = "quotedb-status"
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_zero_trust_access_service_token" "monitor" {
  count      = var.status_monitoring_enabled ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = "QuoteDB health monitor"
  duration   = "8760h"
}
resource "cloudflare_zero_trust_access_policy" "monitor" {
  count      = var.status_monitoring_enabled ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = "QuoteDB health-only service"
  decision   = "non_identity"
  include    = [{ service_token = { token_id = cloudflare_zero_trust_access_service_token.monitor[0].id } }]
}
resource "cloudflare_zero_trust_access_application" "monitor" {
  count            = var.status_monitoring_enabled ? 1 : 0
  account_id       = var.cloudflare_account_id
  name             = "QuoteDB admin health only"
  domain           = "${var.admin_hostname}/_monitor/health"
  type             = "self_hosted"
  session_duration = "1h"
  policies         = [{ id = cloudflare_zero_trust_access_policy.monitor[0].id, precedence = 1 }]
}
resource "random_password" "monitor" {
  for_each = var.status_monitoring_enabled ? toset(["origin", "bot", "operator"]) : toset([])
  length   = 64
  special  = false
}
# OpenTofu owns the domain and its DNS record; Wrangler owns only code/bindings/cron.
resource "cloudflare_workers_custom_domain" "status" {
  count      = var.status_domain_enabled ? 1 : 0
  account_id = var.cloudflare_account_id
  zone_id    = var.cloudflare_zone_id
  hostname   = "status.${var.domain}"
  service    = "quotedb-status"
}
output "status_database_id" {
  value = try(cloudflare_d1_database.status[0].id, null)
}
output "status_secrets" {
  sensitive = true
  value = var.status_monitoring_enabled ? {
    BOT_SECRET           = random_password.monitor["bot"].result
    OPERATOR_SECRET      = random_password.monitor["operator"].result
    ADMIN_MONITOR_SECRET = random_password.monitor["origin"].result
    ACCESS_CLIENT_ID     = cloudflare_zero_trust_access_service_token.monitor[0].client_id
    ACCESS_CLIENT_SECRET = cloudflare_zero_trust_access_service_token.monitor[0].client_secret
  } : null
}
