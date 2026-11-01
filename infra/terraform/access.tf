# Reuse an existing OTP provider when this account already has one.
resource "cloudflare_zero_trust_access_identity_provider" "otp" {
  count      = var.access_otp_provider_id == "" ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = "QuoteDB email code"
  type       = "onetimepin"
  config     = {}
}

resource "cloudflare_zero_trust_access_policy" "admin" {
  account_id = var.cloudflare_account_id
  name       = "QuoteDB administrators"
  decision   = "allow"
  include    = [for email in var.admin_emails : { email = { email = lower(email) } }]
}

resource "cloudflare_zero_trust_access_application" "admin" {
  account_id                = var.cloudflare_account_id
  name                      = "QuoteDB Admin"
  domain                    = var.admin_hostname
  type                      = "self_hosted"
  session_duration          = "8h"
  allowed_idps              = [var.access_otp_provider_id != "" ? var.access_otp_provider_id : cloudflare_zero_trust_access_identity_provider.otp[0].id]
  auto_redirect_to_identity = true
  policies                  = [{ id = cloudflare_zero_trust_access_policy.admin.id, precedence = 1 }]
}

resource "random_password" "auth_code_secret" {
  length  = 64
  special = false
}

# Keep the existing nested hostname as a DNS-only redirect, with Caddy TLS.
resource "cloudflare_dns_record" "admin_access" {
  zone_id = var.cloudflare_zone_id
  type    = "A"
  name    = var.admin_hostname
  content = module.backend.server_ipv4
  ttl     = 1
  proxied = true
}
resource "cloudflare_dns_record" "admin_access_ipv6" {
  zone_id = var.cloudflare_zone_id
  type    = "AAAA"
  name    = var.admin_hostname
  content = module.backend.server_ipv6
  ttl     = 1
  proxied = true
}

# Access protects the ACME HTTP challenge too. Use an Origin CA certificate on
# this proxied hostname instead; keep ordinary Caddy ACME on DNS-only hosts.
resource "tls_private_key" "admin_origin" {
  algorithm = "RSA"
  rsa_bits  = 2048
}
resource "tls_cert_request" "admin_origin" {
  private_key_pem = tls_private_key.admin_origin.private_key_pem
  dns_names       = [var.admin_hostname]
  subject { common_name = var.admin_hostname }
}
resource "cloudflare_origin_ca_certificate" "admin" {
  csr                = tls_cert_request.admin_origin.cert_request_pem
  hostnames          = [var.admin_hostname]
  request_type       = "origin-rsa"
  requested_validity = 1095
}
