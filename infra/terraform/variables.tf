# ── Secrets: pass as TF_VAR_* env vars, never in tfvars or git ──
# (The DigitalOcean provider reads DIGITALOCEAN_TOKEN directly.)

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS:Edit and SSL and Certificates:Edit on the zone and Access Apps/Policies/Identity Providers Write on the account."
  type        = string
  sensitive   = true
}

variable "resend_api_key" {
  description = "Resend API key for transactional email."
  type        = string
  sensitive   = true
}

variable "state_encryption_passphrase" {
  description = "Passphrase for OpenTofu state/plan encryption (min 16 chars). Losing it means losing the state."
  type        = string
  sensitive   = true
}

# ── Settings ──

variable "domain" {
  description = "Apex for the app, e.g. quotes.example.com. Hosts: <domain>, app., admin., api."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone that contains var.domain."
  type        = string
}

variable "digitalocean_region" {
  description = "Droplet region. Changing it replaces the server and its local database."
  type        = string
  default     = "fra1"
}

variable "ssh_public_keys" {
  description = "Public keys for the deploy user: the CI deploy key plus administrator keys."
  type        = list(string)
}

variable "droplet_size" {
  description = "Droplet size (doctl compute size list). Builds run in CI, not on this server."
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "droplet_backups" {
  description = "Enable paid DigitalOcean Droplet backups. Logical database dumps are also needed."
  type        = bool
  default     = false
}

variable "izaro_user_id" {
  description = "User whose quotes /izaro shows (UUID or legacy integer id). Empty disables the page."
  type        = string
  default     = ""
}

variable "izaro_collection_id" {
  description = "Collection UUID explicitly published by /izaro; takes precedence over izaro_user_id."
  type        = string
  default     = ""
}

variable "hibp_enabled" {
  type    = bool
  default = true
}

variable "log_level" {
  type    = string
  default = "info"
}

variable "extra_dns_records" {
  description = "Additional records, e.g. Resend's SPF/DKIM/DMARC values once the Resend dashboard shows them."
  type = map(object({
    type     = string
    name     = string
    content  = string
    priority = optional(number)
  }))
  default = {}
}

variable "cloudflare_account_id" {
  description = "Cloudflare account hosting the Access application."
  type        = string
}
variable "access_team" {
  description = "Existing Zero Trust team slug (without .cloudflareaccess.com)."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.access_team))
    error_message = "Set the existing Cloudflare Zero Trust team slug."
  }
}
variable "admin_hostname" {
  description = "First-level proxied admin hostname covered by the zone certificate, distinct from admin.<domain>."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+$", var.admin_hostname)) && var.admin_hostname != "admin.${var.domain}"
    error_message = "Choose a valid admin hostname distinct from the old redirect hostname."
  }
}
variable "admin_emails" {
  description = "Explicit Access allowlist; these addresses also require a local ADMIN/SUPER_ADMIN role."
  type        = set(string)
  validation {
    condition     = length(var.admin_emails) > 0 && alltrue([for email in var.admin_emails : can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", email))])
    error_message = "Supply at least one administrator email."
  }
}
variable "access_otp_provider_id" {
  description = "Reuse an existing account OTP identity provider, or leave empty to create one."
  type        = string
  default     = ""
}
